#!/usr/bin/env node
'use strict';

// Seeds the database with realistic demo data: a set of fake skills and
// ~200 skill-fire/prompt/session events spread over the last 30 days.
// Targets SKILLSCOPE_DIR if set, otherwise ~/.skillscope. Idempotent-ish:
// re-running adds more events, so wipe the DB if you want a clean slate.

const path = require('node:path');
const { openDb, dbPath } = require(path.join(__dirname, '..', 'src', 'db'));

// Deterministic PRNG so seeded dashboards look the same everywhere.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(424242);

const DAY_MS = 24 * 60 * 60 * 1000;

const DEMO_SKILLS = [
  { name: 'commit-helper', description: 'Writes conventional commit messages from the staged diff.', scope: 'user', mdChars: 5200, weight: 30 },
  { name: 'pr-reviewer', description: 'Reviews pull requests for bugs, style and missing tests.', scope: 'user', mdChars: 9800, weight: 22 },
  { name: 'sql-optimizer', description: 'Analyzes slow queries and suggests indexes and rewrites.', scope: 'project', mdChars: 7400, weight: 12 },
  { name: 'api-docs', description: 'Generates OpenAPI docs from route handlers.', scope: 'project', mdChars: 6100, weight: 8 },
  { name: 'test-writer', description: 'Writes table-driven tests matching project conventions.', scope: 'user', mdChars: 8700, weight: 18 },
  { name: 'changelog', description: 'Drafts changelog entries from merged PRs since last tag.', scope: 'plugin', mdChars: 4300, weight: 5 },
  { name: 'k8s-debugger', description: 'Walks through pod, service and ingress debugging steps.', scope: 'plugin', mdChars: 12500, weight: 3 },
  // Dead weight: installed, never fired.
  { name: 'terraform-audit', description: 'Audits Terraform plans for security and cost issues across all cloud providers with detailed remediation guidance.', scope: 'plugin', mdChars: 15800, weight: 0 },
  { name: 'jira-sync', description: 'Creates and updates Jira tickets from TODO comments and test failures found in the codebase.', scope: 'user', mdChars: 6900, weight: 0 },
  { name: 'i18n-extractor', description: 'Extracts hardcoded strings into translation files.', scope: 'project', mdChars: 5500, weight: 0 },
  { name: 'figma-to-css', description: 'Converts Figma component exports into CSS modules and design tokens for the component library.', scope: 'plugin', mdChars: 11200, weight: 0 },
];

function main() {
  const db = openDb();
  const now = Date.now();
  const upsertSkill = db.prepare(`
    INSERT INTO skills (name, description, path, scope, skill_md_chars, metadata_chars, first_seen, last_scanned)
    VALUES (@name, @description, @path, @scope, @skill_md_chars, @metadata_chars, @first_seen, @last_scanned)
    ON CONFLICT(name) DO UPDATE SET last_scanned = excluded.last_scanned
  `);
  const insertEvent = db.prepare(
    'INSERT INTO events (ts, session_id, event_type, skill_name, tool_name, cwd) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const seedAll = db.transaction(() => {
    for (const skill of DEMO_SKILLS) {
      upsertSkill.run({
        name: skill.name,
        description: skill.description,
        path: `/demo/skills/${skill.name}/SKILL.md`,
        scope: skill.scope,
        skill_md_chars: skill.mdChars,
        metadata_chars: skill.name.length + skill.description.length,
        first_seen: now - 30 * DAY_MS,
        last_scanned: now,
      });
    }

    // Weighted pool for picking which skill fires.
    const pool = [];
    for (const skill of DEMO_SKILLS) {
      for (let i = 0; i < skill.weight; i++) pool.push(skill.name);
    }

    let eventCount = 0;
    let sessionCounter = 0;
    // ~2-5 sessions per day across 30 days, weekdays busier.
    for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
      const dayStart = now - dayOffset * DAY_MS;
      const weekday = new Date(dayStart).getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const sessionsToday = isWeekend ? Math.floor(random() * 2) : 1 + Math.floor(random() * 2);
      for (let s = 0; s < sessionsToday; s++) {
        sessionCounter += 1;
        const sessionId = `demo-session-${String(sessionCounter).padStart(3, '0')}`;
        let ts = dayStart + Math.floor(random() * 10 * 3600 * 1000) + 8 * 3600 * 1000;
        const cwd = random() < 0.5 ? '/home/demo/projects/api' : '/home/demo/projects/web';
        insertEvent.run(ts, sessionId, 'session_start', null, null, cwd);
        eventCount += 1;
        const prompts = 1 + Math.floor(random() * 5);
        for (let p = 0; p < prompts; p++) {
          ts += 30000 + Math.floor(random() * 8 * 60000);
          insertEvent.run(ts, sessionId, 'prompt', null, null, cwd);
          eventCount += 1;
          if (random() < 0.55 && pool.length > 0) {
            ts += 5000 + Math.floor(random() * 60000);
            const skillName = pool[Math.floor(random() * pool.length)];
            insertEvent.run(ts, sessionId, 'skill_fired', skillName, random() < 0.8 ? 'Skill' : 'Read', cwd);
            eventCount += 1;
          }
        }
        ts += 60000;
        insertEvent.run(ts, sessionId, 'session_end', null, null, cwd);
        eventCount += 1;
      }
    }
    return eventCount;
  });

  const total = seedAll();
  console.log(`Seeded ${total} events and ${DEMO_SKILLS.length} demo skills into ${dbPath()}`);
  console.log('Run: node src/cli.js dashboard');
}

main();
