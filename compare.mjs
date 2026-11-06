#!/usr/bin/env node
/**
 * Compare a port with the numbers the original platform printed, bar by bar.
 *
 * A compile proves the names resolve. It says nothing about whether the port
 * computes what the original computes, and a port from another platform is
 * where that most often goes wrong: an average seeded differently, a deviation
 * divided by n - 1 instead of n, an index read the wrong way round. Every one
 * of those compiles. This is the check that finds them, and it needs no copy of
 * the original platform: only a file of the values it showed.
 *
 * ## The file
 *
 * One row per bar, oldest first or newest first, with a header row:
 *
 *   time,open,high,low,close,volume,RSI,Signal
 *   2026-01-05 09:15,24010.5,24055,23990.1,24031.2,182300,,
 *   ...
 *
 * - **time** is the bar's opening time: epoch seconds, epoch milliseconds, an
 *   ISO time with or without a zone, `YYYY-MM-DD HH:MM[:SS]` with `-`, `.` or
 *   `/` between the date parts, or `YYYYMMDD`. A separate `date` and `time`
 *   column pair is joined. A time with no zone is read in `--zone`.
 * - **open, high, low, close** are required, **volume** is read when present.
 *   Short names (`o`, `h`, `l`, `c`, `v`, `vol`) work, in any case.
 * - **Every other column is a value the original printed**, paired with the
 *   port's plot of the same title (case and punctuation ignored) or by
 *   `--map "Title=column"`.
 * - An empty cell, `NaN`, `null`, `None`, `NA`, `#N/A`, and the empty-buffer
 *   markers some platforms write (any value of 1e300 or more, and 2147483647)
 *   read as **no value on that bar**.
 *
 * Comma, semicolon or tab separated. A `.json` file is an array of objects with
 * the same keys.
 *
 * ## What counts as the same
 *
 * An exported value is rounded to the digits it was written with, so each cell
 * allows half a unit in its own last digit, plus a relative `--tolerance`
 * (default 1e-6). A value printed as `45.12` agrees with `45.1234`.
 *
 * Usage:
 *   node .claude/skills/openscript/compare.mjs <port.oscript> <values.csv>
 *     [--settings settings.json] [--set key=value ...] [--map "Title=column" ...]
 *     [--zone Asia/Kolkata] [--interval 5|60|1D|1W] [--skip n] [--tolerance 1e-6]
 *     [--out port-values.csv]
 *
 * Exit status: 0 when every paired plot agrees (warmup aside), 1 when one does
 * not or nothing could be paired, 2 for a usage error.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { compileText, loadCompiler } from './compiler.mjs'

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function usage(message) {
  console.error(message)
  console.error('')
  console.error('  node .claude/skills/openscript/compare.mjs <port.oscript> <values.csv>')
  console.error('    [--settings settings.json] [--set key=value ...] [--map "Title=column" ...]')
  console.error('    [--zone Asia/Kolkata] [--interval 5|60|1D|1W] [--skip n] [--tolerance 1e-6] [--out port.csv]')
  process.exit(2)
}

const VALUED = new Set(['--settings', '--set', '--map', '--zone', '--interval', '--skip', '--tolerance', '--out'])
const argv = process.argv.slice(2)
const flags = { set: [], map: [] }
const positional = []
for (let at = 0; at < argv.length; at++) {
  const one = argv[at]
  if (VALUED.has(one)) {
    const value = argv[++at]
    if (value === undefined) usage(`${one} needs a value.`)
    const key = one.slice(2)
    if (key === 'set' || key === 'map') flags[key].push(value)
    else flags[key] = value
  } else if (one.startsWith('--')) {
    usage(`Unknown option ${one}.`)
  } else {
    positional.push(one)
  }
}
const [portPath, dataPath] = positional
if (!portPath || !dataPath) usage('Give the port and the file of values the original printed.')
for (const path of [portPath, dataPath]) if (!existsSync(path)) usage(`No such file: ${path}`)

const zone = flags.zone ?? 'UTC'
try {
  new Intl.DateTimeFormat('en-US', { timeZone: zone })
} catch {
  usage(`${zone} is not a time zone name. Use an IANA name such as Asia/Kolkata or UTC.`)
}
const relTolerance = flags.tolerance === undefined ? 1e-6 : Number(flags.tolerance)
if (!(relTolerance >= 0)) usage('--tolerance is a number, such as 1e-6.')
const skip = flags.skip === undefined ? 0 : Number(flags.skip)
if (!Number.isInteger(skip) || skip < 0) usage('--skip is a whole number of bars.')

function literal(text) {
  if (text === 'true' || text === 'false') return text === 'true'
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) ? n : text
}

let settings = {}
if (flags.settings) {
  try {
    settings = JSON.parse(readFileSync(flags.settings, 'utf8').replace(/^﻿/, ''))
  } catch {
    usage(`${flags.settings} cannot be read as a JSON object of settings, such as {"length": 14}.`)
  }
}
for (const pair of flags.set) {
  const at = pair.indexOf('=')
  if (at < 1) usage(`--set takes key=value, not ${pair}.`)
  settings[pair.slice(0, at)] = literal(pair.slice(at + 1))
}
const mapping = new Map()
for (const pair of flags.map) {
  const at = pair.lastIndexOf('=')
  if (at < 1) usage(`--map takes "Plot title=column", not ${pair}.`)
  mapping.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')
const FIELD = {
  open: ['open', 'o'], high: ['high', 'h'], low: ['low', 'l'], close: ['close', 'c', 'last'],
  volume: ['volume', 'v', 'vol'],
}
const TIME_NAMES = ['time', 'datetime', 'timestamp', 'date', 'datetimeutc', 'timeutc', 'bartime', 'opentime']

function splitLine(line, sep) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { cells.push(cell); cell = '' }
    else cell += ch
  }
  cells.push(cell)
  return cells.map((one) => one.trim())
}

function readRows(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  if (extname(path).toLowerCase() === '.json') {
    let rows
    try {
      rows = JSON.parse(text)
    } catch {
      usage('The JSON file cannot be read. It must be a non-empty array of objects.')
    }
    if (!Array.isArray(rows) || rows.length === 0) usage('The JSON file must be a non-empty array of objects.')
    // Every key any row has: an exporter that leaves out an empty value drops
    // the key from the warmup rows, and the first row is a warmup row.
    const header = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))]
    return { header, rows: rows.map((row) => header.map((key) => (row?.[key] == null ? '' : String(row[key])))) }
  }
  const lines = text.split(/\r?\n/).filter((one) => one.trim() !== '')
  if (lines.length < 2) usage('The file needs a header row and at least one bar.')
  const first = lines[0]
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0]
  return { header: splitLine(first, sep), rows: lines.slice(1).map((line) => splitLine(line, sep)) }
}

const ABSENT = new Set(['', 'nan', 'null', 'none', 'na', 'n/a', '#n/a', 'empty', 'undefined', '-'])
function numberOf(cell) {
  if (cell === undefined || ABSENT.has(cell.toLowerCase())) return null
  const n = Number(cell.replace(/,/g, ''))
  if (!Number.isFinite(n) || Math.abs(n) >= 1e300 || n === 2147483647) return null
  return n
}

/** Half a unit in the last digit the cell was written with. */
function roundingOf(cell) {
  const m = /^[-+]?(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(cell.replace(/,/g, ''))
  if (!m) return 0
  const decimals = (m[2] ?? '').length - Number(m[3] ?? 0)
  return 0.5 * 10 ** -decimals
}

function zoneOffset(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value])
  )
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs
}

/** Wall clock fields in `--zone` to UTC milliseconds. */
function fromWallClock(y, mo, d, h, mi, s) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const first = guess - zoneOffset(guess)
  return guess - zoneOffset(first)
}

function timeOf(cell) {
  const text = cell.trim()
  if (/^\d{9,13}(\.\d+)?$/.test(text) && !/^\d{8}$/.test(text)) {
    const n = Number(text)
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n)
  }
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (m) return fromWallClock(+m[1], +m[2], +m[3], 0, 0, 0)
  m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(text)
  if (m) return fromWallClock(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  // An ISO time with a zone only: a day-first date such as 05-01-2026 also ends
  // in what looks like an offset, and the lenient parser reads it month first,
  // in this machine's zone.
  if (/^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}.*([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const t = Date.parse(text)
    if (Number.isFinite(t)) return t
  }
  return null
}

const { header, rows } = readRows(dataPath)
const columnOf = (names) => header.findIndex((h) => names.includes(squash(h)))
const used = new Set()
const fieldAt = {}
for (const [field, names] of Object.entries(FIELD)) {
  const at = columnOf(names)
  if (at !== -1) { fieldAt[field] = at; used.add(at) }
}
for (const field of ['open', 'high', 'low', 'close']) {
  if (fieldAt[field] === undefined) usage(`The file has no ${field} column. Its header reads: ${header.join(', ')}`)
}

let readTime
const dateAt = header.findIndex((h) => squash(h) === 'date')
const clockAt = header.findIndex((h) => squash(h) === 'time')
if (dateAt !== -1 && clockAt !== -1 && /^\d{1,2}:\d{2}/.test(rows[0][clockAt] ?? '')) {
  used.add(dateAt); used.add(clockAt)
  readTime = (row) => timeOf(`${row[dateAt]} ${row[clockAt]}`)
} else {
  const at = columnOf(TIME_NAMES)
  if (at === -1) usage(`The file has no time column. Its header reads: ${header.join(', ')}`)
  used.add(at)
  readTime = (row) => timeOf(row[at])
}

let bars = rows.map((row, line) => {
  const time = readTime(row)
  if (time === null) usage(`Row ${line + 2}: the time cannot be read. Write it as ISO (2026-01-05T09:15:00) or as epoch seconds.`)
  const bar = { time }
  for (const [field, at] of Object.entries(fieldAt)) bar[field] = numberOf(row[at])
  return { bar, row, line: line + 2 }
})

let reversed = false
if (bars.length > 1 && bars[0].bar.time > bars.at(-1).bar.time) {
  bars.reverse()
  reversed = true
}
for (let i = 1; i < bars.length; i++) {
  if (bars[i].bar.time <= bars[i - 1].bar.time) {
    usage(`The times are not in order, or repeat, at row ${bars[i].line} of the file. Every bar needs its own time.`)
  }
}

function inferInterval() {
  const gaps = bars.slice(1).map((one, i) => one.bar.time - bars[i].bar.time).sort((a, b) => a - b)
  const minutes = Math.round((gaps[Math.floor(gaps.length / 2)] ?? 86_400_000) / 60_000)
  if (minutes >= 27 * 1440) return '1M'
  if (minutes >= 7 * 1440) return '1W'
  if (minutes >= 1440 - 60) return '1D'
  return String(Math.max(1, minutes))
}
// The engine reads a count with an optional unit; any other code leaves
// chart.intervalMinutes empty, and the run would quietly be on no interval.
if (flags.interval !== undefined && !/^\d+[smhDWM]?$/.test(flags.interval)) {
  usage(`--interval ${flags.interval} is not an interval. Write minutes as a number (5, 60), or 1D, 1W or 1M.`)
}
const interval = flags.interval ?? inferInterval()

// ---------------------------------------------------------------------------
// Running the port
// ---------------------------------------------------------------------------

const { engine, version } = await loadCompiler()
const compiled = compileText(engine, basename(portPath), readFileSync(portPath, 'utf8'))
if (compiled.hasErrors) {
  console.log('The port does not compile, so there is nothing to compare:')
  for (const one of compiled.diagnostics) console.log(`  ${one.code} ${one.severity} line ${one.span?.line ?? '?'}: ${one.message}`)
  process.exit(1)
}
const program = compiled.program

// A setting is keyed by the name its input is assigned to, which is not the
// title the dialog shows. Take either, and refuse a name that is neither:
// ignored quietly, it would compare the defaults while saying otherwise.
const inputs = program.inputs ?? []
for (const key of Object.keys(settings)) {
  if (inputs.some((one) => one.key === key)) continue
  const byTitle = inputs.find((one) => String(one.label).toLowerCase() === key.toLowerCase())
  if (byTitle) {
    settings[byTitle.key] = settings[key]
    delete settings[key]
    continue
  }
  const known = inputs.map((one) => `${one.key} ("${one.label}")`).join(', ') || 'none'
  usage(`The port has no input called ${key}. Its inputs are: ${known}`)
}

const instrument = {
  symbol: 'COMPARE', interval, timezone: zone, tickSize: 0.01, hasVolume: bars.some((one) => one.bar.volume != null),
}
const loaded = engine.load(program, {
  source: compiled.file, settings, host: { instrument, now: bars.at(-1).bar.time },
})
if (!loaded.ok) {
  console.log(`The port would not load: ${loaded.diagnostic.code} ${loaded.diagnostic.message}`)
  process.exit(1)
}
try {
  loaded.engine.run(bars.map((one) => one.bar))
} catch (error) {
  console.log(`The port stopped while running: ${error?.message ?? error}`)
  process.exit(1)
}

const plots = program.outputs.plots.map((p) => ({
  title: p.title,
  values: Array.from(loaded.engine.column(p.channel), (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))),
}))

// ---------------------------------------------------------------------------
// Pairing and comparing
// ---------------------------------------------------------------------------

for (const title of mapping.keys()) {
  if (!plots.some((p) => p.title === title)) {
    usage(`--map names a plot "${title}" the port does not have. Its plots are: ${plots.map((p) => p.title).join(', ') || 'none'}`)
  }
}
const valueColumns = header.map((h, at) => ({ h, at })).filter((one) => !used.has(one.at))
const pairs = []
const claimed = new Set()
for (const plot of plots) {
  const wanted = mapping.get(plot.title)
  const column = wanted !== undefined
    ? valueColumns.find((one) => one.h === wanted) ?? valueColumns.find((one) => squash(one.h) === squash(wanted))
    : valueColumns.find((one) => !claimed.has(one.at) && squash(one.h) === squash(plot.title))
  if (wanted !== undefined && !column) usage(`--map names a column "${wanted}" the file does not have.`)
  if (column) { claimed.add(column.at); pairs.push({ plot, column }) }
}

const stamp = (i) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(bars[i].bar.time)).replace(',', '')
const when = (i) => `bar ${i} (${stamp(i)})`
const show = (v) => (v === null ? 'no value' : Number(v.toPrecision(10)).toString())

function agrees(port, cell) {
  const orig = numberOf(cell)
  if (port === null || orig === null) return port === orig
  return Math.abs(port - orig) <= roundingOf(cell) + relTolerance * Math.max(Math.abs(port), Math.abs(orig)) + 1e-12
}

function ranges(indexes) {
  if (indexes.length === 0) return 'none'
  const out = []
  let start = indexes[0]
  let prev = start
  for (const i of [...indexes.slice(1), Infinity]) {
    if (i !== prev + 1) { out.push(start === prev ? `${start}` : `${start} to ${prev}`); start = i }
    prev = i
  }
  return `bars ${out.slice(0, 6).join(', ')}${out.length > 6 ? `, and ${out.length - 6} more runs` : ''} (${indexes.length} bars)`
}

function compare({ plot, column }) {
  const port = plot.values
  const cells = bars.map((one) => one.row[column.at] ?? '')
  const orig = cells.map(numberOf)
  const both = [], differ = [], portOnly = [], origOnly = []
  for (let i = skip; i < bars.length; i++) {
    const a = port[i], b = orig[i]
    if (a === null && b === null) continue
    if (a === null) { origOnly.push(i); continue }
    if (b === null) { portOnly.push(i); continue }
    both.push(i)
    if (!agrees(a, cells[i])) differ.push(i)
  }

  console.log(`${plot.title}  against column "${column.h}"`)
  if (both.length === 0) {
    console.log('  no bar has a value on both sides, so nothing was compared')
    console.log('')
    return 'empty'
  }
  console.log(`  agree on ${both.length - differ.length} of the ${both.length} bars where both have a value`)

  const absentAtStartOnly = (list) => list.every((i) => i < both[0])
  if (differ.length > 0) {
    const first = differ[0]
    const worst = differ.reduce((w, i) => (Math.abs(port[i] - orig[i]) > Math.abs(port[w] - orig[w]) ? i : w), first)
    console.log(`  first difference: ${when(first)}, original ${show(orig[first])}, port ${show(port[first])}`)
    console.log(`  largest difference: ${when(worst)}, original ${show(orig[worst])}, port ${show(port[worst])}`)
  }
  if (origOnly.length) console.log(`  the original has a value and the port none: ${ranges(origOnly)}`)
  if (portOnly.length) console.log(`  the port has a value and the original none: ${ranges(portOnly)}`)

  // What the shape of the difference suggests. Each is stated as a look, not
  // a cause: the cause is in the original's source, and that is where to read.
  if (differ.length > 0) {
    let explained = false
    const tail = both.filter((i) => i > differ.at(-1))
    if (tail.length >= Math.max(20, both.length * 0.2)) {
      explained = true
      console.log(`  every bar after ${differ.at(-1)} agrees (${tail.length} bars): the early bars differ and then converge,`)
      console.log('  which is how a different seed or a different start of a recursion looks')
    }
    for (const k of explained ? [] : [1, -1, 2, -2, 3, -3]) {
      let match = 0, seen = 0
      for (const i of both) {
        const j = i - k
        if (j < 0 || j >= bars.length || orig[j] === null) continue
        seen++
        if (agrees(port[i], cells[j])) match++
      }
      if (seen > 20 && match / seen > 0.98) {
        explained = true
        const word = k > 0 ? 'later' : 'earlier'
        console.log(`  the port matches the original ${Math.abs(k)} bar(s) ${word} on ${match} of ${seen} bars: one side is offset,`)
        console.log('  usually an index read the wrong way round, a shift or offset argument, or a time stamped at the close')
        break
      }
    }
    // A steady scale or a steady offset, judged with the same rounding as the
    // comparison, and only where the differences run through the whole file.
    if (!explained && differ.length >= Math.max(10, both.length * 0.5)) {
      const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      const fits = (predict) => differ.filter((i) => {
        const room = roundingOf(cells[i]) * Math.max(1, Math.abs(predict.scale ?? 1)) + 1e-4 * Math.max(Math.abs(port[i]), 1e-12)
        return Math.abs(port[i] - predict(orig[i])) <= room
      }).length / differ.length
      const r = median(differ.filter((i) => orig[i] !== 0).map((i) => port[i] / orig[i]))
      const byScale = Object.assign((v) => r * v, { scale: r })
      const d = median(differ.map((i) => port[i] - orig[i]))
      const byOffset = Object.assign((v) => v + d, { scale: 1 })
      // The room is loose enough that noise fits a tiny offset, and that an
      // offset on a high price fits a scale near 1. An explanation must also
      // leave less than a tenth of the difference, and the closer one is named.
      const miss = (predict) => differ.reduce((sum, i) => sum + Math.abs(port[i] - predict(orig[i])), 0)
      const gap = miss((v) => v)
      const scaleFits = Number.isFinite(r) && Math.abs(r - 1) > 1e-3 && fits(byScale) > 0.95 && miss(byScale) < 0.1 * gap
      const offsetFits = Math.abs(d) > 0 && fits(byOffset) > 0.95 && miss(byOffset) < 0.1 * gap
      if (scaleFits && !(offsetFits && miss(byOffset) < miss(byScale))) {
        const round = [100, -100, 0.01, -0.01, -1, 1000, 0.001].find((c) => Math.abs(r / c - 1) < 1e-3)
        const shown = round ?? Number(r.toPrecision(6))
        let why = 'a scale: a percent against a fraction, a x100, or a sign'
        const n = r < 1 ? 1 / (1 - r * r) : 1 / (1 - 1 / (r * r))
        if (r > 0 && Math.abs(n - Math.round(n)) < 0.02 && Math.round(n) >= 2 && Math.round(n) <= 5000) {
          const len = Math.round(n)
          why = r < 1
            ? `sqrt((n - 1) / n) for n = ${len}: the port divides by n where the original divides by n - 1 (population against sample)`
            : `sqrt(n / (n - 1)) for n = ${len}: the port divides by n - 1 where the original divides by n (sample against population)`
        }
        console.log(`  the port is a steady ${shown} times the original, which is ${why}`)
      } else if (offsetFits) {
        console.log(`  the port is a steady ${Number(d.toPrecision(6))} away from the original: a constant offset or a different centre line`)
      }
    }
  }
  console.log('')

  if (differ.length > 0) return 'different'
  if (portOnly.length === 0 && origOnly.length === 0) return 'same'
  return absentAtStartOnly(portOnly) && absentAtStartOnly(origOnly) ? 'warmup' : 'gaps'
}

// ---------------------------------------------------------------------------

console.log(`Comparing ${basename(portPath)} with ${basename(dataPath)}, openalgo-script ${version}.`)
console.log(`${bars.length} bars, ${stamp(0)} to ${stamp(bars.length - 1)} ${zone}, interval ${interval}.`)
if (reversed) console.log('The file lists the newest bar first; it was read oldest first.')
if (Object.keys(settings).length) console.log(`Settings: ${JSON.stringify(settings)}`)
if (skip) console.log(`The first ${skip} bars are left out of the judgement.`)
console.log('')

const verdicts = pairs.map(compare)

const unpairedPlots = plots.filter((p) => !pairs.some((one) => one.plot === p)).map((p) => p.title)
const unpairedColumns = valueColumns.filter((one) => !claimed.has(one.at)).map((one) => one.h)
if (unpairedPlots.length) console.log(`Plots with no column: ${unpairedPlots.join(', ')}`)
if (unpairedColumns.length) console.log(`Columns with no plot: ${unpairedColumns.join(', ')}`)
if (unpairedPlots.length && unpairedColumns.length) console.log('Pair them with --map "Plot title=column".')
if (unpairedPlots.length || unpairedColumns.length) console.log('')

if (flags.out) {
  const cell = (text) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const lines = [['time', ...plots.map((p) => cell(String(p.title)))].join(',')]
  bars.forEach((one, i) => lines.push([new Date(one.bar.time).toISOString(), ...plots.map((p) => (p.values[i] === null ? '' : p.values[i]))].join(',')))
  writeFileSync(flags.out, lines.join('\n') + '\n')
  console.log(`The port's values are in ${flags.out}.`)
  console.log('')
}

if (pairs.length === 0) {
  console.log('NOT COMPARED: no plot of the port matched a column of the file.')
  process.exit(1)
}
const counts = (word) => verdicts.filter((v) => v === word).length
if (counts('different') + counts('gaps') + counts('empty') === 0) {
  const note = counts('warmup') ? ', apart from where each side starts answering' : ''
  console.log(`SAME: ${pairs.length} of ${pairs.length} paired plot(s) agree on every bar${note}.`)
  console.log('That is parity on these bars and these settings only. Run other settings, and bars with gaps, before calling the port done.')
  process.exit(0)
}
console.log(`DIFFERENT: ${counts('different')} plot(s) differ, ${counts('gaps')} have values missing mid-run on one side, ${counts('empty')} had nothing to compare.`)
process.exit(1)
