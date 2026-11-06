#!/usr/bin/env node
/**
 * Run the compiler's own importer on a script from the version-annotated chart
 * language (scripts that open with `//@version=5` or `//@version=6`), and write
 * the draft it hands back.
 *
 * The importer brings each statement across with its original meaning, or with
 * a warning stating the difference, or as a comment with an error, in the range
 * OS9001 to OS9012. **What comes out is a draft, not a port**: every finding is
 * a place to read, and the draft goes through `validate.mjs` like any other.
 *
 * It never writes into `strategies/openscript/`. The draft goes beside the
 * original, or where `--out` says.
 *
 * Usage:
 *   node .claude/skills/openscript/import.mjs <original.txt>
 *   node .claude/skills/openscript/import.mjs <original.txt> --out <draft.oscript>
 */

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { compileText, loadCompiler } from './compiler.mjs'

function usage(message) {
  console.error(message)
  console.error('')
  console.error('  node .claude/skills/openscript/import.mjs <original.txt>')
  console.error('  node .claude/skills/openscript/import.mjs <original.txt> --out <draft.oscript>')
  process.exit(2)
}

const argv = process.argv.slice(2)
const outAt = argv.indexOf('--out')
const outArg = outAt === -1 ? null : argv[outAt + 1]
const original = argv.find((one, at) => !one.startsWith('--') && !(outAt !== -1 && at === outAt + 1))
if (!original) usage('Give the original script to import.')
if (!existsSync(original)) usage(`No such file: ${original}`)
if (outAt !== -1 && !outArg) usage('--out needs a file name.')

const out = resolve(outArg ?? join(dirname(original), `${basename(original, extname(original))}.oscript`))
// The folder as the disk names it, and in lower case: a link, or the folder
// typed in another case on a Mac or Windows disk, reaches the same folder. The
// slash added also catches the folder itself.
const where = existsSync(dirname(out)) ? join(realpathSync.native(dirname(out)), basename(out)) : out
if (`${where.split(/[\\/]/).join('/')}/`.toLowerCase().includes('/strategies/openscript/')) {
  usage('The draft never goes into strategies/openscript/. Write it to a scratch folder, then install it with validate.mjs --install.')
}
if (existsSync(out) && realpathSync.native(out) === realpathSync.native(original)) {
  usage(`The draft would replace the original ${original}. Give the draft its own name with --out.`)
}
if (existsSync(out) && statSync(out).isDirectory()) {
  usage(`${out} is a folder. Give --out a file name, such as ${join(out, 'draft.oscript')}.`)
}
if (!existsSync(dirname(out))) {
  usage(`The folder ${dirname(out)} does not exist. Create it first, or give --out a file in a folder that does.`)
}

const { engine, version } = await loadCompiler()
const result = engine.importScript(readFileSync(original, 'utf8'), { name: basename(original) })

console.log(`Imported with openalgo-script ${version}.`)
console.log('')

const errors = result.findings.filter((one) => one.severity === 'error')
const warnings = result.findings.filter((one) => one.severity !== 'error')
for (const one of result.findings) {
  const where = one.span ? `line ${one.span.line}` : 'whole file'
  console.log(`${one.code} ${one.severity} ${where}: ${one.message}`)
}
if (result.findings.length > 0) console.log('')

if (!result.source) {
  const versioned = result.findings.some((one) => one.code === 'OS9001')
  console.log('Nothing was translated.')
  if (versioned) {
    console.log('The importer reads version 5 and version 6 scripts only. The source platform\'s own')
    console.log('editor converts a version 4 script to version 5, and a version 3 script to version 4;')
    console.log('convert it as far as that goes and import the result. A script that does not convert,')
    console.log('or has no version line, is ported by hand with reference/porting-from-any-platform.md.')
  }
  process.exit(1)
}

writeFileSync(out, result.source)
console.log(`Draft written to ${out}`)
console.log(`  ${errors.length} statement(s) kept as a comment, ${warnings.length} warning(s) where the meaning can differ.`)

const compiled = compileText(engine, basename(out), result.source)
const compileErrors = compiled.diagnostics.filter((one) => one.severity === 'error')
if (compileErrors.length > 0) {
  console.log('')
  console.log('The draft does not compile yet:')
  for (const one of compiled.diagnostics) {
    console.log(`  ${one.code} ${one.severity} line ${one.span?.line ?? '?'}: ${one.message}`)
  }
}

console.log('')
console.log('Read every finding above, finish the draft, then compile it:')
console.log(`  node .claude/skills/openscript/validate.mjs ${out}`)
console.log('and compare it with the original\'s own numbers:')
console.log(`  node .claude/skills/openscript/compare.mjs ${out} <exported.csv>`)
