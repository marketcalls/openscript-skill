#!/usr/bin/env node
/**
 * Hold the two porting pages to the compiler.
 *
 * ## Why this is a script and not a careful read
 *
 * A porting page is trusted at the one moment it matters: an author reads that
 * `stdev` divides by n, or that `ema` is seeded with a simple mean, and writes
 * a port on the strength of it. A claim that has drifted sends that port wrong
 * in a way the compiler never reports, because every variant compiles.
 *
 * So two things are checked, against the compiler that is installed:
 *
 * 1. **Every `openscript` block on both porting pages.** A block that starts
 *    with `version 1` is a whole file; any other is wrapped in `version 1` and
 *    a `study(...)` line. A block whose first line begins `// Wrong:` must
 *    produce every code that line names, or, where the line says it
 *    "compiles", must compile; every other block must compile with no
 *    diagnostic at all.
 * 2. **Every row of the definitions table** in
 *    `reference/porting-from-any-platform.md`. Each expression is run on test
 *    bars, with the page's helper block above it, and compared on every bar
 *    with an implementation written here from the definition, independently of
 *    the compiler. The first bar it answers on must be the one the table
 *    states. The table and the list below must name the same expressions, so
 *    neither can grow alone.
 *
 * Usage: node .claude/skills/openscript/check-porting.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL, compileText, loadCompiler } from './compiler.mjs'

const { engine, version } = await loadCompiler()
const NL = String.fromCharCode(10)
let failures = 0
const fail = (message) => {
  failures++
  console.log(`  FAIL ${message}`)
}

// ---------------------------------------------------------------------------
// 1. Every block compiles as the page says
// ---------------------------------------------------------------------------

const PAGES = ['porting-from-any-platform.md', 'porting-from-javascript.md']
const WRAP = ['version 1', 'study("Probe", overlay = true)']

function blocksOf(text) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```openscript') continue
    const body = []
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== '```') body.push(lines[j++])
    out.push({ line: i + 1, body })
    i = j
  }
  return out
}

function fileFor(body) {
  return (body[0]?.trim() === 'version 1' ? body : [...WRAP, ...body]).join(NL) + NL
}

let blockCount = 0
for (const page of PAGES) {
  const text = readFileSync(join(SKILL, 'reference', page), 'utf8')
  console.log(`${page}`)
  for (const block of blocksOf(text)) {
    blockCount++
    const result = compileText(engine, 'block.oscript', fileFor(block.body))
    const codes = result.diagnostics.map((one) => one.code)
    const errors = result.diagnostics.filter((one) => one.severity === 'error').map((one) => one.code)
    const head = block.body[0] ?? ''
    const where = `${page}:${block.line}`
    if (head.startsWith('// Wrong:')) {
      const named = [...head.matchAll(/OS\d{4}/g)].map((m) => m[0])
      if (named.length > 0) {
        for (const code of named) if (!codes.includes(code)) fail(`${where} names ${code}, and the compiler reports ${codes.join(', ') || 'nothing'}`)
      } else if (/compiles/.test(head) && errors.length > 0) {
        fail(`${where} says it compiles, and the compiler reports ${errors.join(', ')}`)
      }
    } else if (codes.length > 0) {
      fail(`${where} should compile with no diagnostic, and the compiler reports ${result.diagnostics.map((one) => `${one.code} line ${(one.span?.line ?? 0) - (block.body[0]?.trim() === 'version 1' ? 0 : WRAP.length)}: ${one.message}`).join(' | ')}`)
    }
  }
}
console.log(`BLOCKS        ${blockCount} blocks checked`)

// ---------------------------------------------------------------------------
// 2. The definitions table, measured
// ---------------------------------------------------------------------------

// Deterministic bars: a random walk with real ranges and volume, long enough
// for every seed to matter and to wash out.
function makeBars(n, seed) {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const bars = []
  let c = 100
  for (let i = 0; i < n; i++) {
    const o = c + (rnd() - 0.5) * 0.6
    const cl = o + (rnd() - 0.5) * 2
    const h = Math.max(o, cl) + rnd() * 1.2
    const l = Math.min(o, cl) - rnd() * 1.2
    bars.push({ time: Date.UTC(2026, 0, 5) + i * 3_600_000, open: o, high: h, low: l, close: cl, volume: Math.round(1000 + rnd() * 9000) })
    c = cl
  }
  return bars
}
const bars = makeBars(600, 7)
const N = bars.length
const O = bars.map((b) => b.open), H = bars.map((b) => b.high), L = bars.map((b) => b.low), C = bars.map((b) => b.close), V = bars.map((b) => b.volume)

// Independent implementations, written from each definition.
const empty = () => new Array(N).fill(null)
const present = (xs) => xs.every((v) => v !== null)
const win = (x, i, n) => (i < n - 1 ? null : x.slice(i - n + 1, i + 1))
const map2 = (a, b, f) => a.map((v, i) => (v === null || b[i] === null ? null : f(v, b[i])))
const sma = (x, n) => x.map((_, i) => { const w = win(x, i, n); return w && present(w) ? w.reduce((p, q) => p + q, 0) / n : null })
function seededBy(x, n, a) {
  const out = empty()
  const start = x.findIndex((v) => v !== null)
  let e = x.slice(start, start + n).reduce((p, q) => p + q, 0) / n
  out[start + n - 1] = e
  for (let i = start + n; i < N; i++) out[i] = e = a * x[i] + (1 - a) * e
  return out
}
const ema = (x, n) => seededBy(x, n, 2 / (n + 1))
const rma = (x, n) => seededBy(x, n, 1 / n)
const fromFirst = (x, a) => { let e = null; return x.map((v) => (e = e === null ? v : a * v + (1 - a) * e)) }
const adjusted = (x, a) => { let num = 0, den = 0; return x.map((v) => { num = v + (1 - a) * num; den = 1 + (1 - a) * den; return num / den }) }
const partial = (x, n) => x.map((_, i) => { const w = x.slice(Math.max(0, i - n + 1), i + 1); return w.reduce((p, q) => p + q, 0) / w.length })
const wma = (x, n) => x.map((_, i) => { const w = win(x, i, n); if (!w || !present(w)) return null; let s = 0; w.forEach((v, k) => (s += v * (k + 1))); return s / ((n * (n + 1)) / 2) })
const stdev = (x, n, sample) => x.map((_, i) => { const w = win(x, i, n); if (!w) return null; const m = w.reduce((p, q) => p + q, 0) / n; return Math.sqrt(w.reduce((p, q) => p + (q - m) ** 2, 0) / (sample ? n - 1 : n)) })
const TR = C.map((_, i) => (i === 0 ? H[i] - L[i] : Math.max(H[i], C[i - 1]) - Math.min(L[i], C[i - 1])))
const TR1 = TR.map((v, i) => (i === 0 ? null : v))
const change = C.map((c, i) => (i === 0 ? null : c - C[i - 1]))
const gains = change.map((d) => (d === null ? null : Math.max(d, 0)))
const losses = change.map((d) => (d === null ? null : Math.max(-d, 0)))
const rsiOf = (up, down) => map2(up, down, (u, d) => (d === 0 ? 100 : 100 - 100 / (1 + u / d)))
const highest = (x, n) => x.map((_, i) => { const w = win(x, i, n); return w && present(w) ? Math.max(...w) : null })
const lowest = (x, n) => x.map((_, i) => { const w = win(x, i, n); return w && present(w) ? Math.min(...w) : null })
const back = (x, k) => x.map((_, i) => (i - k >= 0 ? x[i - k] : null))
const TP = bars.map((b) => (b.high + b.low + b.close) / 3)
const cciOn = (x, n) => x.map((v, i) => { const w = win(x, i, n); if (!w) return null; const m = w.reduce((p, q) => p + q, 0) / n; const md = w.reduce((p, q) => p + Math.abs(q - m), 0) / n; return (v - m) / (0.015 * md) })
const rankIn = (x, n) => x.map((v, i) => { const w = win(x, i, n); return w ? (100 * w.filter((q) => q <= v).length) / n : null })
const rankBefore = (x, n) => x.map((v, i) => { if (i < n) return null; let k = 0; for (let j = 1; j <= n; j++) if (x[i - j] <= v) k++; return (100 * k) / n })
const rawK = (n) => C.map((c, i) => { if (i < n - 1) return null; const hh = Math.max(...H.slice(i - n + 1, i + 1)), ll = Math.min(...L.slice(i - n + 1, i + 1)); return (100 * (c - ll)) / (hh - ll) })
const macdLine = map2(ema(C, 12), ema(C, 26), (a, b) => a - b)
const hma = (x, n) => wma(map2(wma(x, Math.floor(n / 2)), wma(x, n), (a, b) => 2 * a - b), Math.round(Math.sqrt(n)))
let obvRun = 0
const obv = C.map((c, i) => (i === 0 ? (obvRun = 0) : (obvRun += c > C[i - 1] ? V[i] : c < C[i - 1] ? -V[i] : 0)))
const flow = TP.map((t, i) => t * V[i])
const mfi = (n) => TP.map((_, i) => { if (i < n) return null; let p = 0, q = 0; for (let k = 0; k < n; k++) { const j = i - k; if (TP[j] > TP[j - 1]) p += flow[j]; else if (TP[j] < TP[j - 1]) q += flow[j] } return q === 0 ? 100 : 100 - 100 / (1 + p / q) })

const EXPECTED = {
  'sma(close, 20)': sma(C, 20),
  'partialMean(close, 20)': partial(C, 20),
  'ema(close, 14)': ema(C, 14),
  'emaFromFirst(close, 14)': fromFirst(C, 2 / 15),
  'emaAdjusted(close, 14)': adjusted(C, 2 / 15),
  'rma(close, 14)': rma(C, 14),
  'rmaFromFirst(close, 14)': fromFirst(C, 1 / 14),
  'wma(close, 14)': wma(C, 14),
  'stdev(close, 20)': stdev(C, 20, false),
  'stdev(close, 20, true)': stdev(C, 20, true),
  'trueRange()': TR,
  'atr(14)': rma(TR, 14),
  'sma(trueRange(), 14)': sma(TR, 14),
  'rma(bar.index > 0 ? trueRange() : none, 14)': rma(TR1, 14),
  'rsi(close, 14)': rsiOf(rma(gains, 14), rma(losses, 14)),
  'rsiSimple(close, 14)': rsiOf(sma(gains, 14), sma(losses, 14)),
  'highest(high, 20)': highest(H, 20),
  'highest(high[1], 20)': highest(back(H, 1), 20),
  'roc(close, 10)': C.map((c, i) => (i < 10 ? null : (100 * (c - C[i - 10])) / C[i - 10])),
  'mom(close, 10)': C.map((c, i) => (i < 10 ? null : c - C[i - 10])),
  '100 * close / close[10]': C.map((c, i) => (i < 10 ? null : (100 * c) / C[i - 10])),
  'cci(20)': cciOn(TP, 20),
  'cciOf(close, 20)': cciOn(C, 20),
  'percentRank(close, 20)': rankIn(C, 20),
  'rankOfPrevious(close, 20)': rankBefore(C, 20),
  'stoch(14, 3, 3)[0]': sma(rawK(14), 3),
  'stoch(14, 3, 3)[1]': sma(sma(rawK(14), 3), 3),
  'bollinger(close, 20, 2)[1]': map2(sma(C, 20), stdev(C, 20, false), (m, s) => m + 2 * s),
  'sma(close, 20) + 2 * stdev(close, 20, true)': map2(sma(C, 20), stdev(C, 20, true), (m, s) => m + 2 * s),
  'macd(close, 12, 26, 9)[0]': macdLine,
  'macd(close, 12, 26, 9)[1]': ema(macdLine, 9),
  'sma(macd(close, 12, 26, 9)[0], 9)': sma(macdLine, 9),
  'williamsR(14)': C.map((c, i) => { if (i < 13) return null; const hh = Math.max(...H.slice(i - 13, i + 1)), ll = Math.min(...L.slice(i - 13, i + 1)); return (-100 * (hh - c)) / (hh - ll) }),
  'hma(close, 15)': hma(C, 15),
  'obv()': obv,
  'mfi(14)': mfi(14),
}
void O
void lowest

const pageText = readFileSync(join(SKILL, 'reference', 'porting-from-any-platform.md'), 'utf8')
const section = pageText.slice(pageText.indexOf('## Same name, different numbers'))
const helperBlock = blocksOf(section).find((one) => one.body[0]?.startsWith('// Helpers for the table below'))
if (!helperBlock) fail('the page has no helper block opening "// Helpers for the table below"')
const helpers = (helperBlock?.body ?? []).filter((line) => !line.startsWith('plot('))

const rows = []
for (const line of section.split(/\r?\n/)) {
  const m = /^\| `([^`]+)` \| .* \| bar (\d+) \|$/.exec(line)
  if (m) rows.push({ expr: m[1], first: Number(m[2]) })
  if (rows.length > 0 && line.startsWith('## ') && !line.startsWith('## Same name')) break
}

const onPage = new Set(rows.map((one) => one.expr))
for (const expr of Object.keys(EXPECTED)) if (!onPage.has(expr)) fail(`checked here and not on the page: ${expr}`)
for (const row of rows) if (!(row.expr in EXPECTED)) fail(`on the page and not checked here: ${row.expr}`)

const probe = [...WRAP, ...helpers]
rows.forEach((row, k) => probe.push(`d${k} = ${row.expr}`, `plot(d${k}, "D${k}")`))
const compiled = compileText(engine, 'definitions.oscript', probe.join(NL) + NL)
if (compiled.diagnostics.length > 0) {
  for (const one of compiled.diagnostics) fail(`definitions file: ${one.code} line ${one.span?.line}: ${one.message}`)
}
let measured = 0
if (compiled.program) {
  const loaded = engine.load(compiled.program, {
    source: compiled.file,
    host: { instrument: { symbol: 'CHECK', interval: '60', timezone: 'UTC', tickSize: 0.01 }, now: bars.at(-1).time },
  })
  if (!loaded.ok) fail(`the definitions file would not load: ${loaded.diagnostic.message}`)
  else {
    loaded.engine.run(bars)
    const titled = new Map(compiled.program.outputs.plots.map((p) => [p.title, p.channel]))
    rows.forEach((row, k) => {
      const want = EXPECTED[row.expr]
      if (!want) return
      const got = Array.from(loaded.engine.column(titled.get(`D${k}`)), (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)))
      const first = got.findIndex((v) => v !== null)
      if (first !== row.first) fail(`${row.expr}: the page says it first answers on bar ${row.first}, and it answers on bar ${first}`)
      for (let i = 0; i < N; i++) {
        const a = got[i], b = want[i] ?? null
        const off = (a === null) !== (b === null) || (a !== null && Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)))
        if (off) {
          fail(`${row.expr}: bar ${i} is ${a}, and the definition the page states gives ${b}`)
          return
        }
      }
      measured++
    })
  }
}
console.log(`DEFINITIONS   ${measured}/${rows.length} rows match their stated definition on every one of ${N} bars`)
console.log('')
console.log(`openalgo-script ${version}`)
if (failures > 0) {
  console.log(`PORTING NOT VERIFIED: ${failures} failure(s).`)
  process.exit(1)
}
console.log('PORTING VERIFIED')
