# SkillScope

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

**Google Analytics for your Claude Code skills.** See which skills actually fire, what they cost in context, and which ones are dead weight.

## Why

Skills are open-loop. You install them, they inject their name and description into **every single session**, and then... you have no idea what happens. Did that skill ever trigger? Is it earning the context it costs? Claude Code gives you no way to answer that.

SkillScope closes the loop. It hooks into Claude Code's hooks system and tells you:

1. **Which skills actually trigger**, and which have *never* fired
2. **What each skill costs** in estimated context tokens
3. **Your dead weight**: skills whose metadata taxes every session but never get used

## Install

```sh
git clone https://github.com/joeykokinda/SkillScope.git
cd SkillScope
npm install
node src/cli.js init     # or: npx skillscope init (once published)
```

That's it. Use Claude Code normally. Events collect silently in the background.

## Commands

| Command | What it does |
|---|---|
| `skillscope init` | Merges collection hooks into `~/.claude/settings.json` (backup saved first, existing hooks untouched) |
| `skillscope dashboard` | Local dashboard at `http://localhost:4321` |
| `skillscope status` | Terminal summary: skill count, % never fired, top 5, metadata tax |
| `skillscope uninstall` | Surgically removes only SkillScope's hooks, keeps your data |

Want a populated dashboard right now? `npm run seed` loads 30 days of demo data.

## Privacy

**Everything is 100% local. Loudly: there are zero network calls in this codebase.**

- All data lives in `~/.skillscope/skillscope.db` on your machine
- **Prompt text is never read or stored.** Prompts are counted, that's it
- No telemetry, no phone-home, no cloud, no accounts
- The collector is failure-proof by design: it always exits 0 and can never break or block your agent

Audit it yourself, the whole thing is a few hundred lines of plain JavaScript.

## How it works

```
 Claude Code session
 ────────────────────
   │
   │  hooks (PostToolUse, SessionStart,
   │         SessionEnd, UserPromptSubmit)
   ▼
 ┌──────────────────┐   JSON payload    ┌─────────────────────────┐
 │ settings.json    │ ────────────────▶ │ collect.js              │
 │ hook entries     │      (stdin)      │ parse, classify, insert │
 └──────────────────┘                   └───────────┬─────────────┘
                                                    ▼
                                        ┌─────────────────────────┐
                                        │ ~/.skillscope/          │
                                        │   skillscope.db (SQLite)│
                                        └───────────┬─────────────┘
                  ┌─────────────────────────────────┤
                  ▼                                 ▼
        ┌──────────────────┐              ┌──────────────────┐
        │ scan.js          │              │ skillscope        │
        │ inventory of all │              │ dashboard/status  │
        │ installed skills │              │ (localhost only)  │
        └──────────────────┘              └──────────────────┘
```

A skill "fire" is recorded when Claude invokes the native `Skill` tool, or when it `Read`s a `SKILL.md` file directly. The scanner inventories skills from `~/.claude/skills/`, project `.claude/skills/` directories, and installed plugins, then estimates context cost as `chars / 4`.

## Uninstall

```sh
skillscope uninstall      # removes only SkillScope's hooks from settings.json
rm -rf ~/.skillscope      # optional: delete collected data
```

A timestamped backup of `settings.json` is written before every modification, so you can always roll back by hand.

## Roadmap

- Optional cloud dashboard for teams
- Team view: aggregate skill usage across engineers
- Cross-agent support (other agent frameworks with hook systems)
- Skill A/B insights: which description phrasings actually get a skill triggered
- `skillscope prune`: one command to remove dead-weight skills

## License

[MIT](LICENSE)
