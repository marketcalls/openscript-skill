/**
 * Find the OpenScript compiler this app ships, for the scripts beside this file.
 *
 * The same search `validate.mjs` makes: a front end developer's
 * `frontend/node_modules` at the exact pinned version, then this skill's own
 * cache, then one download of the one package (it has no dependencies) into
 * that cache. Nobody has to build the front end to port a script.
 *
 * The version comes from `frontend/package.json` when there is one, so a port
 * cannot quietly compile against an API the running app does not have. Outside
 * an OpenAlgo checkout there is no pin, and the latest published version is
 * used.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SKILL = import.meta.dirname
export const REPO_ROOT = resolve(SKILL, '..', '..', '..')
const DEV_ROOT = join(REPO_ROOT, 'frontend', 'node_modules', 'openalgo-script')
const CACHE_ROOT = join(SKILL, '.cache')

function pinnedVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'frontend', 'package.json'), 'utf8'))
    const spec = pkg.dependencies?.['openalgo-script'] ?? pkg.devDependencies?.['openalgo-script']
    return typeof spec === 'string' ? spec.replace(/^[\^~]/, '') : null
  } catch {
    return null
  }
}

function installedVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

function entryPoint(root) {
  return join(root, 'dist', 'core', 'index.js')
}

function fetchPackage(version, prefix) {
  mkdirSync(prefix, { recursive: true })
  const spec = version ? `openalgo-script@${version}` : 'openalgo-script'
  // npm is a .cmd on Windows and Node will not spawn one without a shell. With
  // a shell nothing is auto-quoted, so the paths are quoted here.
  const win = process.platform === 'win32'
  const q = (s) => (win ? `"${s}"` : s)
  execFileSync(
    win ? 'npm.cmd' : 'npm',
    ['install', q(spec), '--prefix', q(prefix), '--no-save', '--no-package-lock',
     '--no-audit', '--no-fund', '--loglevel', 'error'],
    { stdio: ['ignore', 'ignore', 'pipe'], shell: win }
  )
}

function resolveRoot() {
  const want = pinnedVersion()
  if (existsSync(entryPoint(DEV_ROOT))) return DEV_ROOT

  const prefix = join(CACHE_ROOT, `v${want ?? 'latest'}`)
  const cached = join(prefix, 'node_modules', 'openalgo-script')
  if (existsSync(entryPoint(cached))) {
    const have = installedVersion(cached)
    if (!want || have === want) return cached
  }

  console.error(`Fetching openalgo-script@${want ?? 'latest'} (one package, no dependencies)...`)
  fetchPackage(want, prefix)
  if (!existsSync(entryPoint(cached))) throw new Error('the fetched package has no dist/core/index.js')
  return cached
}

/** The compiler's module and its version, or the process exits with a sentence saying why not. */
export async function loadCompiler() {
  let root
  try {
    root = resolveRoot()
  } catch (cause) {
    console.error('Could not get the compiler this app ships.')
    console.error(`  ${cause.message}`)
    console.error('Connect to the network once so the one package can be cached, then run this again.')
    process.exit(1)
  }
  const engine = await import(pathToFileURL(entryPoint(root)).href)
  return { engine, version: installedVersion(root) ?? 'unknown' }
}

/** Compile one text. Answers the program (absent on an error) and every diagnostic. */
export function compileText(engine, name, text) {
  const file = engine.sourceFile(name, engine.normaliseSource(text))
  const bag = new engine.DiagnosticBag()
  const { program } = engine.emit(file, engine.check(file, engine.parse(file, bag), bag), bag)
  return { file, program: bag.hasErrors ? undefined : program, diagnostics: bag.ordered(), hasErrors: bag.hasErrors }
}
