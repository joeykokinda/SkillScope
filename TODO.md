# TODO

## Repo metadata (web UI only, GitHub has no git/API path for some of these)

- [ ] About panel: description, website (npm link), topics (`claude-code`, `claude`, `anthropic`, `agent-skills`, `observability`, `analytics`, `developer-tools`, `hooks`, `ai-agents`, `local-first`)
- [ ] Settings → Social preview: upload `docs/dashboard.png`
- [ ] GitHub Release for v0.1.1

## Pre-launch

- [ ] Dogfood: install full skill set, run real Claude Code sessions, capture real dead-weight numbers from `skillscope status`
- [ ] Watch the dashboard for Read-detection noise (SKILL.md reads while editing skills count as fires)
- [ ] Screenshot the real dashboard for the launch thread
- [ ] Rotate the npm publish token

## Launch

- [ ] Twitter/X thread with real numbers
- [ ] r/ClaudeAI and the Claude Code subreddit
- [ ] Show HN (disclose the Read false positive up front, it is documented in ASSUMPTIONS.md)
- [ ] Submit to skill directories and awesome-claude-code / awesome-claude-skills lists

## v1.1

- [ ] Reduce Read false positives: ignore SKILL.md reads immediately followed by an Edit/Write to the same path
- [ ] `skillscope prune`: list and remove dead-weight skills, clean stale rows for uninstalled skills
- [ ] Composite `(name, path)` key so same-named skills in different scopes don't collapse
- [ ] CI: GitHub Actions running `npm test` on Node 18/20/22
- [ ] Windows pass: hook marker uses a POSIX shell comment, untested on cmd
- [ ] Vendor Chart.js so the dashboard works fully offline
- [ ] Session-end inference fallback for sessions that die without a SessionEnd hook
