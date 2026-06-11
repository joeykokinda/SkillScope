# SkillScope

[![npm](https://img.shields.io/npm/v/skillscope)](https://www.npmjs.com/package/skillscope)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

**Google Analytics for your Claude Code skills.** See which skills actually fire, what they cost in context, and which ones are dead weight.

![SkillScope dashboard](https://raw.githubusercontent.com/joeykokinda/SkillScope/main/docs/dashboard.png)

## Why

Skills are open-loop. You install them, they inject their name and description into **every single session**, and then... you have no idea what happens. Did that skill ever trigger? Is it earning the context it costs? Claude Code gives you no way to answer that.

SkillScope closes the loop. It hooks into Claude Code's hooks system and tells you:

1. **Which skills actually trigger**, and which have *never* fired
2. **What each skill costs** in estimated context tokens
3. **Your dead weight**: skills whose metadata taxes every session but never get used

## Install

```sh
npx skillscope init
```

That's it. Use Claude Code normally. Events collect silently in the background.

The hook points at the installed copy of the collector, so for a long-lived setup prefer a global install (npx cache cleanup would otherwise remove it):

```sh
npm install -g skillscope
skillscope init
```

Hacking on it instead? `git clone https://github.com/joeykokinda/SkillScope.git && cd SkillScope && npm install`, then `node src/cli.js <cmd>`.

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

## Known limitations

Documented honestly so you can trust the numbers (full decision log in [ASSUMPTIONS.md](ASSUMPTIONS.md)):

- **Read-based detection can over-count.** Any `Read` of a `SKILL.md` counts as a fire, including Claude reading one while you edit a skill. If you author skills, your own fire counts will run slightly hot. A filter is planned ([TODO](TODO.md)).
- Token numbers are estimates (`chars / 4`), not exact tokenizer counts.
- Two skills with the same name in different scopes currently collapse into one row.
- Uninstalled skills stay in the dashboard until you delete the DB (`prune` command planned).
- Installed via `npx`? The hook points at the npx cache; prefer `npm i -g` so cache cleanup can't remove the collector.

## Roadmap

Short-term work is tracked in [TODO.md](TODO.md). Bigger ideas:

- Optional cloud dashboard for teams
- Team view: aggregate skill usage across engineers
- Cross-agent support (other agent frameworks with hook systems)
- Skill A/B insights: which description phrasings actually get a skill triggered
- `skillscope prune`: one command to remove dead-weight skills

## FAQ

### How do I see which Claude Code skills are actually being used?

Run `npx skillscope init` once, use Claude Code normally, then `skillscope dashboard`. Every skill invocation is recorded locally, so the dashboard shows fires per skill, sessions where it fired, and last-fired time. Anything that has never fired lands in the dead-weight table.

### How much context do my skills cost?

Each installed skill injects its name and description into every session (the "metadata tax"), and its full SKILL.md when it fires. SkillScope estimates both as `chars / 4` tokens and shows cost per load, per-session tax, and total estimated tokens consumed per skill.

### Does SkillScope send my data anywhere?

No. There are no network calls in the collector, the database is a local SQLite file, and prompt text is never read or stored. The only external fetch anywhere is the dashboard page loading Chart.js from a CDN.

### Which Claude Code hooks does it use?

`PostToolUse` (matcher `Skill|Read`), `SessionStart`, `SessionEnd`, and `UserPromptSubmit`, merged into `~/.claude/settings.json` with a timestamped backup. `skillscope uninstall` removes them surgically.

## License

[MIT](LICENSE)
