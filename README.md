# OpenScript Skill for AI Coding Agents

An agent skill that writes OpenScript indicators and strategies for [OpenAlgo](https://github.com/marketcalls/openalgo), and converts them from TradingView Pine Script or any other platform. It hands back the complete code only after the code compiles with the same [OpenScript](https://github.com/marketcalls/openscript) compiler the browser uses.

Works with Claude Code, Cursor, Codex, OpenCode, Cline, Windsurf, GitHub Copilot, Gemini CLI and the other agents supported by [skills.sh](https://github.com/vercel-labs/skills).

## What it does

- **Builds indicators and strategies** from a plain description ("an EMA crossover with a 1% stop and 2% target, intraday only").
- **Converts TradingView Pine Script** to OpenScript. Version 5 and 6 scripts go through the compiler's own importer, which flags every place the meaning can differ; older versions are converted by hand.
- **Converts from any other platform or language**: other chart and terminal scripting languages, C-like and C# indicator code, array formula languages, Python and pandas, spreadsheets, or a formula from a book.
- **Hands back the complete `.oscript` code**, compiled with `openalgo-script`, with every warning explained. Paste it into the OpenScript editor on `/trading`, or, with the skill inside an OpenAlgo folder, let it install the source and its compiled program into `strategies/openscript/` together.
- Checks a conversion bar by bar against the original platform's own numbers (an exported CSV of its bars and indicator values), and names the usual cause of a mismatch: a different seed, a one-bar shift, a sample against a population deviation, a percentage against a fraction.
- Knows where indicators with the same name compute different numbers on different platforms. Every definition in its reference is measured against the compiler, not recalled.
- Looks names up in a reference of all 350 library names, generated from the compiler, with the 95 that are planned and not yet implemented marked.

## Install

```bash
# in any project, or globally for every project
npx skills add marketcalls/openscript-skill
npx skills add marketcalls/openscript-skill -g
```

Or clone it by hand into your agent's skills folder:

```bash
git clone https://github.com/marketcalls/openscript-skill .claude/skills/openscript
```

Writing, converting and checking code works wherever it is installed. Only installing a finished script into OpenAlgo's `strategies/openscript/` folder needs the skill inside the OpenAlgo folder (run the install from its root); anywhere else it hands back the code and refuses to install, and you paste the code into the OpenScript editor on `/trading`.

An up-to-date OpenAlgo checkout already includes this skill at `.claude/skills/openscript/`. This repository is for agents that install skills on their own, and for anyone who wants to read or reuse it outside OpenAlgo.

## Requirements

- Node.js 20.11 or later.
- Network access the first time. The validator downloads one package, `openalgo-script`, which has no dependencies, and caches it in the skill folder. A front end developer with `frontend/node_modules` installed uses that copy at the exact version OpenAlgo pins.

No `npm install` of the OpenAlgo front end is needed.

## Usage

Ask your agent, for example:

- "Write an OpenScript strategy that buys when RSI(14) crosses above 30 and exits at RSI 70, with a 1.5% stop loss."
- "Convert this TradingView Pine Script indicator to OpenScript." (paste the script)
- "Convert this Pine Script strategy to an OpenScript strategy with the same entries and exits."
- "Convert this indicator from my other trading platform to OpenScript, and check it against values.csv, which I exported from that platform."
- "Convert this pandas indicator to an OpenScript study that gives the same numbers."
- "Why does my mean-reversion.oscript fail with OS2020?"

The validator can also be run directly from the OpenAlgo root:

```bash
# compile only
node .claude/skills/openscript/validate.mjs my_strategy.oscript

# compile, and install both files only if there are zero errors
node .claude/skills/openscript/validate.mjs my_strategy.oscript --install

# install under a different name
node .claude/skills/openscript/validate.mjs draft.oscript --install --as mean-reversion.oscript

# import a //@version=5 or 6 script as a draft
node .claude/skills/openscript/import.mjs original.txt --out draft.oscript

# compare a port with the values the original platform exported
node .claude/skills/openscript/compare.mjs draft.oscript values.csv --zone Asia/Kolkata
```

A pass means the compiler accepted the script. It does not mean the strategy is profitable or that its numbers are right: nothing here runs a single bar. Backtest it on `/trading` and run it in analyzer mode (Sandbox) before trading it Live.

## Contents

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions the agent loads |
| `validate.mjs` | Compiles a draft and installs it only on a clean pass |
| `import.mjs` | Imports a `//@version=5` or `6` script as a draft, with a finding for every difference |
| `compare.mjs` | Runs a port on exported bars and compares it with the original's values, bar by bar |
| `reference/library.md` | All 350 names, with warmups, and which are planned |
| `reference/pitfalls.md` | Common mistakes, each with the diagnostic code you will see |
| `reference/strategies.md` | Strategy shapes, and the steps between a compile and trading Live |
| `reference/porting-from-any-platform.md` | Porting from any platform or language, with the definitions that differ between platforms |
| `reference/porting-from-javascript.md` | Porting an OpenAlgo JavaScript chart indicator into a study |
| `examples/*.oscript` | Six worked examples, all of which compile |
| `generate-reference.mjs`, `coverage.mjs`, `check-pitfalls.mjs`, `check-porting.mjs` | Keep the reference and the porting pages in step with the compiler |
| `compiler.mjs` | Finds or fetches the compiler for the scripts above |

## Source

The skill is maintained in the OpenAlgo repository at [`.claude/skills/openscript`](https://github.com/marketcalls/openalgo/tree/main/.claude/skills/openscript), and this repository is published from there. Report issues and send changes to OpenAlgo.

## License

MIT. See [LICENSE](LICENSE).
