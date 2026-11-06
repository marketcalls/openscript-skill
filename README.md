# OpenScript Skill for AI Coding Agents

An agent skill that writes, ports and debugs [OpenScript](https://github.com/marketcalls/openscript) studies and strategies for [OpenAlgo](https://github.com/marketcalls/openalgo), and installs a script only after it compiles with the same compiler the browser uses.

Works with Claude Code, Cursor, Codex, OpenCode, Cline, Windsurf, GitHub Copilot, Gemini CLI and the other agents supported by [skills.sh](https://github.com/vercel-labs/skills).

## What it does

- Drafts a `.oscript` study or strategy from a plain description ("an EMA crossover with a 1% stop and 2% target, intraday only").
- Compiles it with `openalgo-script` and reports every diagnostic code before anything is installed.
- Installs the source and its compiled program into `strategies/openscript/` together, from one compile, or not at all. The runner reads only the compiled program, so a source without one is a strategy that cannot run.
- Ports scripts from other chart languages (`//@version=5` and `//@version=6`) and from OpenAlgo JavaScript chart indicators.
- Looks names up in a reference of all 350 library names, generated from the compiler, with the 95 that are planned and not yet implemented marked.

## Install

Run this from the root of your OpenAlgo folder:

```bash
npx skills add marketcalls/openscript-skill
```

Or copy it by hand:

```bash
git clone https://github.com/marketcalls/openscript-skill
cp -r openscript-skill/.claude/skills/openscript /path/to/openalgo/.claude/skills/
```

Install it into the OpenAlgo project, not globally (`-g`). The skill writes into the `strategies/openscript/` folder of the project it sits in, so a global install has nowhere correct to put scripts.

An up-to-date OpenAlgo checkout already includes this skill at `.claude/skills/openscript/`. This repository is for agents that install skills on their own, and for anyone who wants to read or reuse it outside OpenAlgo.

## Requirements

- Node.js 20.11 or later.
- Network access the first time. The validator downloads one package, `openalgo-script`, which has no dependencies, and caches it in the skill folder. A front end developer with `frontend/node_modules` installed uses that copy at the exact version OpenAlgo pins.

No `npm install` of the OpenAlgo front end is needed.

## Usage

Ask your agent, for example:

- "Write an OpenScript strategy that buys when RSI(14) crosses above 30 and exits at RSI 70, with a 1.5% stop loss."
- "Port this `//@version=5` chart script to OpenScript." (paste the script)
- "Why does my mean-reversion.oscript fail with OS2020?"

The validator can also be run directly from the OpenAlgo root:

```bash
# compile only
node .claude/skills/openscript/validate.mjs my_strategy.oscript

# compile, and install both files only if there are zero errors
node .claude/skills/openscript/validate.mjs my_strategy.oscript --install

# install under a different name
node .claude/skills/openscript/validate.mjs draft.oscript --install --as mean-reversion.oscript
```

A pass means the compiler accepted the script. It does not mean the strategy is profitable or that its numbers are right: nothing here runs a single bar. Backtest it on `/trading` and run it in analyzer mode (Sandbox) before trading it Live.

## Contents

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions the agent loads |
| `validate.mjs` | Compiles a draft and installs it only on a clean pass |
| `reference/library.md` | All 350 names, with warmups, and which are planned |
| `reference/pitfalls.md` | Common mistakes, each with the diagnostic code you will see |
| `reference/strategies.md` | Strategy shapes, and the steps between a compile and trading Live |
| `reference/porting-from-javascript.md` | Porting an OpenAlgo JavaScript chart indicator into a study |
| `examples/*.oscript` | Six worked examples, all of which compile |
| `generate-reference.mjs`, `coverage.mjs`, `check-pitfalls.mjs` | Keep the reference in step with the compiler |

## Source

The skill is maintained in the OpenAlgo repository at [`.claude/skills/openscript`](https://github.com/marketcalls/openalgo/tree/main/.claude/skills/openscript), and this repository is published from there. Report issues and send changes to OpenAlgo.

## License

MIT. See [LICENSE](LICENSE).
