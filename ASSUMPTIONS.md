# Assumptions and judgment calls

Decision log from the initial build.

## Hook payloads and detection

- Verified hook payload shapes against the local Claude Code installation: all events carry `session_id`, `transcript_path`, `cwd`, `hook_event_name`; PostToolUse adds `tool_name`, `tool_input`, `tool_response`; SessionStart adds `source`; SessionEnd adds `reason`; UserPromptSubmit adds `prompt`. Field names matched expectations, no adaptation needed.
- The PostToolUse hook is registered with matcher `Skill|Read` instead of `*`. Only those two tools matter for skill detection, and the narrow matcher avoids spawning the collector on every Bash/Edit/etc. call. Tool events for other tools are therefore not recorded at all.
- The native `Skill` tool's input carries the skill name in `tool_input.skill`; the collector also accepts `skill_name`, `name`, and `command` as fallbacks in case the field changes.
- Plugin-namespaced skill invocations (`plugin:skill`) are stored under the bare skill name so they join up with the scanner's inventory, which also uses bare names.
- A `Read` of any path matching `**/skills/<name>/SKILL.md` counts as a fire of `<name>`, regardless of which directory it lives in. This can over-count (e.g. Claude reading a SKILL.md out of curiosity while editing it), accepted for MVP.
- PostToolUse payloads with tool inputs other than Skill/Read, unknown hook event names, garbage JSON, and empty stdin all write nothing and exit 0.
- The hook command ends with `# skillscope` as a marker comment; install/uninstall identify SkillScope's entries by `skillscope` + `collect.js` in the command string. Hooks run through a POSIX shell so the trailing comment is safe; Windows cmd is untested for MVP.
- SessionEnd appears reliable in current Claude Code, so session end is taken from the hook rather than inferred from last-event timestamps. If a session dies without SessionEnd, its events still count; only `session_end` rows are missing, and nothing currently depends on them.

## Scanner

- Plugin skills are found via `~/.claude/plugins/installed_plugins.json` (each install's `installPath/skills/*/SKILL.md`), which covers only actually-installed plugins. If that manifest is missing or unparseable, a bounded recursive walk of `~/.claude/plugins/cache` looks for `skills/` directories. Marketplace checkouts of *non-installed* plugins are deliberately excluded so they don't inflate the never-fired stat.
- Frontmatter parsing is a minimal flat `key: value` parser, no YAML dependency. Real skill frontmatter is flat; multi-line YAML values fall back gracefully (missing description, never a crash). A SKILL.md without frontmatter is kept, named after its directory.
- `skills.name` is the primary key per the spec, so two skills with the same name in different scopes collapse into one row; the most recent scan wins. Acceptable for MVP, noted for a future `(name, path)` key.
- The scanner only upserts; it never deletes rows. Skills that are uninstalled later remain in the table (and in the dashboard) until the DB is deleted. This also keeps seeded demo skills stable across rescans. A `skillscope prune` command is on the roadmap.
- Project skill directories are discovered from distinct `cwd` values in collected events, so a project's skills only appear after at least one hook event fired in that project.

## Token estimates

- "Tokens" everywhere are estimates: `ceil(chars / 4)`. Cost per load is the full SKILL.md char count; the per-session metadata tax is `name + description` chars. Both are labeled as estimates in the UI.
- "Total est. tokens consumed" is `all-time fires x cost per load`, while charts and the hero fire count use a 30-day window. Per-skill table shows all-time fires.

## CLI and storage

- `better-sqlite3` pinned to ^12 because 11.x fails to compile against Node 26's V8. 12.x still supports Node >= 18.
- WAL mode plus a 2s busy timeout handle concurrent hook writes; each collector invocation opens and closes its own connection.
- The collector has a 4-second self-destruct timer and a 10 MB stdin cap as backstops; it always exits 0 by construction.
- `SKILLSCOPE_DIR`, `SKILLSCOPE_CLAUDE_DIR`, `SKILLSCOPE_SETTINGS` env overrides exist so tests (and cautious users) never touch real data. Defaults are `~/.skillscope`, `~/.claude`, `~/.claude/settings.json`.
- `init` writes the absolute path of the local `src/collect.js` into settings, so moving the cloned repo breaks collection until `init` is re-run. Unavoidable without a global install.
- `uninstall` backs up settings.json before cleaning, removes only hook entries carrying the SkillScope marker, drops groups/events that become empty, and leaves the database.
- The dashboard binds to 127.0.0.1 only, preferred port 4321, walking upward up to 50 ports if taken.

## Seed and verification

- `npm run seed` targets the real `~/.skillscope` DB by default (the point is screenshotting your own dashboard); it adds 11 fake skills (4 of them dead weight) and ~200 events over 30 days using a fixed-seed PRNG, so seeded dashboards look the same everywhere. Re-running adds more events.
- Dashboard render was verified with headless Chromium against seeded data: all five sections populate, both Chart.js charts draw, DOM contains the expected numbers. Chart.js loads from jsdelivr CDN, which is the single exception to "no network": the *dashboard page* (never the collector) needs internet on first load unless the CDN file is cached.
- `skillscope init` was NOT run against the real `~/.claude/settings.json` during this build; all init/uninstall verification ran against fixture settings files. Run `node src/cli.js init` yourself to start collecting.

## Repo

- Repo directory is `skillscope` under `~/Projects/ai`; the GitHub remote uses the provided `joeykokinda/SkillScope` URL.
- No npm publish performed; `npx skillscope` works once someone publishes the package, README says "once published".
