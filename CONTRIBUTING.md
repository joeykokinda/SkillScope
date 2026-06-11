# Contributing

PRs welcome. Ground rules:

- Plain JavaScript, no build step, no new runtime dependencies without a strong case
- The collector (`src/collect.js`) must always exit 0 and never make network calls; that invariant is non-negotiable
- Prompt text must never be stored
- Run `npm test` before opening a PR; add a test for any behavior change
- Keep the dashboard a single self-contained HTML file

## Dev setup

```sh
npm install
npm test          # plain-node test suite
npm run seed      # 30 days of demo data (uses SKILLSCOPE_DIR if set)
node src/cli.js dashboard
```

`SKILLSCOPE_DIR`, `SKILLSCOPE_CLAUDE_DIR`, and `SKILLSCOPE_SETTINGS` env vars redirect all filesystem paths, so you can develop without touching your real Claude Code setup.
