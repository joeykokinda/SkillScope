#!/usr/bin/env node
'use strict';

// Plain-node test runner. No framework. Exit code 0 = all green.

const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const COLLECT = path.join(ROOT, 'src', 'collect.js');

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  const pass = () => {
    passed += 1;
    console.log(`  ok    ${name}`);
  };
  const fail = (error) => {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(pass, fail));
    } else {
      pass();
    }
  } catch (error) {
    fail(error);
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skillscope-test-${label}-`));
}

function runCollect(input, dataDir) {
  return spawnSync('node', [COLLECT], {
    input,
    env: { ...process.env, SKILLSCOPE_DIR: dataDir },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function openTestDb(dataDir) {
  process.env.SKILLSCOPE_DIR = dataDir;
  const { openDb } = require(path.join(ROOT, 'src', 'db'));
  return openDb();
}

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// ---------------------------------------------------------------- collector

console.log('\ncollector');
{
  const dataDir = tempDir('collect');

  test('Skill tool fire writes skill_fired row, exit 0', () => {
    const result = runCollect(fixture('post_tool_use_skill.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE event_type = 'skill_fired'").get();
    db.close();
    assert.ok(row, 'expected a skill_fired row');
    assert.strictEqual(row.skill_name, 'commit-helper');
    assert.strictEqual(row.tool_name, 'Skill');
    assert.strictEqual(row.session_id, 'sess-fixture-001');
    assert.strictEqual(row.cwd, '/home/demo/projects/api');
  });

  test('plugin-namespaced skill name is unqualified', () => {
    const result = runCollect(fixture('post_tool_use_skill_plugin.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE skill_name = 'changelog'").get();
    db.close();
    assert.ok(row, 'expected skill name "changelog" without plugin prefix');
  });

  test('Read of SKILL.md writes skill_fired row with resolved name', () => {
    const result = runCollect(fixture('post_tool_use_read_skill.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE skill_name = 'pr-reviewer'").get();
    db.close();
    assert.ok(row, 'expected skill_fired for pr-reviewer');
    assert.strictEqual(row.tool_name, 'Read');
  });

  test('Read of a normal file writes nothing', () => {
    const before = countEvents(dataDir);
    const result = runCollect(fixture('post_tool_use_read_other.json'), dataDir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(countEvents(dataDir), before);
  });

  test('unrelated tool (Bash) writes nothing', () => {
    const before = countEvents(dataDir);
    const result = runCollect(fixture('post_tool_use_bash.json'), dataDir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(countEvents(dataDir), before);
  });

  test('SessionStart writes session_start row', () => {
    const result = runCollect(fixture('session_start.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE event_type = 'session_start'").get();
    db.close();
    assert.ok(row);
    assert.strictEqual(row.session_id, 'sess-fixture-003');
  });

  test('SessionEnd writes session_end row', () => {
    const result = runCollect(fixture('session_end.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE event_type = 'session_end'").get();
    db.close();
    assert.ok(row);
  });

  test('UserPromptSubmit counts the prompt but never stores its text', () => {
    const result = runCollect(fixture('user_prompt_submit.json'), dataDir);
    assert.strictEqual(result.status, 0);
    const db = openTestDb(dataDir);
    const row = db.prepare("SELECT * FROM events WHERE event_type = 'prompt'").get();
    const everything = db.prepare('SELECT * FROM events').all();
    db.close();
    assert.ok(row, 'expected a prompt row');
    assert.ok(
      !JSON.stringify(everything).includes('SECRET-PROMPT-TEXT'),
      'prompt text leaked into the database'
    );
  });

  test('garbage stdin exits 0, writes nothing', () => {
    const before = countEvents(dataDir);
    const result = runCollect('this is {{ not json', dataDir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(countEvents(dataDir), before);
  });

  test('empty stdin exits 0', () => {
    const result = runCollect('', dataDir);
    assert.strictEqual(result.status, 0);
  });

  test('valid JSON with unknown hook_event_name exits 0, writes nothing', () => {
    const before = countEvents(dataDir);
    const result = runCollect('{"hook_event_name":"SomethingNew","session_id":"x"}', dataDir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(countEvents(dataDir), before);
  });
}

function countEvents(dataDir) {
  const db = openTestDb(dataDir);
  const n = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  db.close();
  return n;
}

// ------------------------------------------------------- settings.json merge

console.log('\nsettings merge');
{
  const { mergeHooks, removeHooks, installHooks, uninstallHooks } = require(path.join(ROOT, 'src', 'settings'));

  test('case a: no settings at all -> hooks created', () => {
    const merged = mergeHooks({});
    for (const event of ['PostToolUse', 'SessionStart', 'SessionEnd', 'UserPromptSubmit']) {
      assert.ok(Array.isArray(merged.hooks[event]), `missing hooks.${event}`);
      assert.strictEqual(merged.hooks[event].length, 1);
      assert.ok(merged.hooks[event][0].hooks[0].command.includes('collect.js'));
    }
    assert.strictEqual(merged.hooks.PostToolUse[0].matcher, 'Skill|Read');
  });

  test('case b: existing unrelated hooks and settings preserved', () => {
    const existing = {
      model: 'claude-fable-5',
      theme: 'dark',
      hooks: {
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter --check' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
      },
    };
    const merged = mergeHooks(existing);
    assert.strictEqual(merged.model, 'claude-fable-5');
    assert.strictEqual(merged.theme, 'dark');
    assert.strictEqual(merged.hooks.PostToolUse.length, 2, 'unrelated PostToolUse group must remain');
    assert.strictEqual(merged.hooks.PostToolUse[0].hooks[0].command, 'my-linter --check');
    assert.strictEqual(merged.hooks.Stop.length, 1, 'unrelated Stop hook must remain');
    // Original object untouched (pure function).
    assert.strictEqual(existing.hooks.PostToolUse.length, 1);
  });

  test('case c: idempotent, no duplicates on repeat merge', () => {
    const once = mergeHooks({});
    const twice = mergeHooks(mergeHooks({}));
    assert.deepStrictEqual(twice, once);
    assert.strictEqual(twice.hooks.PostToolUse.length, 1);
  });

  test('removeHooks strips only skillscope entries', () => {
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter --check' }] }],
      },
    };
    const merged = mergeHooks(existing);
    const cleaned = removeHooks(merged);
    assert.deepStrictEqual(cleaned, existing);
  });

  test('removeHooks on settings without hooks is a no-op', () => {
    assert.deepStrictEqual(removeHooks({ model: 'opus' }), { model: 'opus' });
  });

  test('installHooks/uninstallHooks round-trip on disk with backup', () => {
    const dir = tempDir('settings');
    const settingsFile = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'beep' }] }] } }));
    const previous = process.env.SKILLSCOPE_SETTINGS;
    process.env.SKILLSCOPE_SETTINGS = settingsFile;
    try {
      const { backupPath } = installHooks();
      assert.ok(backupPath && fs.existsSync(backupPath), 'backup must exist');
      const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      assert.strictEqual(onDisk.theme, 'dark');
      assert.ok(onDisk.hooks.PostToolUse.some((g) => g.hooks.some((h) => h.command.includes('collect.js'))));
      assert.strictEqual(onDisk.hooks.Stop[0].hooks[0].command, 'beep');

      uninstallHooks();
      const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      assert.deepStrictEqual(after, { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'beep' }] }] } });
    } finally {
      if (previous === undefined) delete process.env.SKILLSCOPE_SETTINGS;
      else process.env.SKILLSCOPE_SETTINGS = previous;
    }
  });
}

// ------------------------------------------------------------------ scanner

console.log('\nscanner');
{
  const { discoverSkills, parseFrontmatter } = require(path.join(ROOT, 'src', 'scan'));
  const claudeHome = tempDir('claude');
  const projectDir = tempDir('project');

  function writeSkill(baseDir, name, frontmatter, body) {
    const dir = path.join(baseDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`);
  }

  writeSkill(
    path.join(claudeHome, 'skills'),
    'alpha-skill',
    'name: alpha-skill\ndescription: "First fake skill for tests."',
    '# Alpha\nDoes alpha things.'
  );
  writeSkill(
    path.join(claudeHome, 'skills'),
    'beta-skill',
    "name: beta-skill\ndescription: 'Second fake skill.'",
    '# Beta'
  );
  writeSkill(
    path.join(projectDir, '.claude', 'skills'),
    'gamma-skill',
    'description: Project-scoped fake skill.',
    '# Gamma'
  );
  // Broken frontmatter: must not crash the scan, falls back to dir name.
  const brokenDir = path.join(claudeHome, 'skills', 'broken-skill');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'SKILL.md'), 'no frontmatter here at all');
  // Plugin skill via installed_plugins.json.
  const pluginInstall = path.join(claudeHome, 'plugins', 'cache', 'mkt', 'tool', '1.0.0');
  writeSkill(path.join(pluginInstall, 'skills'), 'delta-skill', 'name: delta-skill\ndescription: Plugin fake skill.', '# Delta');
  fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'tool@mkt': [{ installPath: pluginInstall }] } })
  );

  const previous = process.env.SKILLSCOPE_CLAUDE_DIR;
  process.env.SKILLSCOPE_CLAUDE_DIR = claudeHome;
  let skills;
  try {
    skills = discoverSkills([projectDir]);
  } finally {
    if (previous === undefined) delete process.env.SKILLSCOPE_CLAUDE_DIR;
    else process.env.SKILLSCOPE_CLAUDE_DIR = previous;
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  test('finds user, project and plugin skills', () => {
    assert.ok(byName.has('alpha-skill'), 'alpha-skill missing');
    assert.ok(byName.has('beta-skill'), 'beta-skill missing');
    assert.ok(byName.has('gamma-skill'), 'gamma-skill missing');
    assert.ok(byName.has('delta-skill'), 'delta-skill (plugin) missing');
    assert.strictEqual(byName.get('alpha-skill').scope, 'user');
    assert.strictEqual(byName.get('gamma-skill').scope, 'project');
    assert.strictEqual(byName.get('delta-skill').scope, 'plugin');
  });

  test('parses frontmatter name/description, strips quotes', () => {
    assert.strictEqual(byName.get('alpha-skill').description, 'First fake skill for tests.');
    assert.strictEqual(byName.get('beta-skill').description, 'Second fake skill.');
    assert.strictEqual(byName.get('gamma-skill').description, 'Project-scoped fake skill.');
  });

  test('computes char counts', () => {
    const alpha = byName.get('alpha-skill');
    assert.ok(alpha.skill_md_chars > 50);
    assert.strictEqual(alpha.metadata_chars, 'alpha-skill'.length + 'First fake skill for tests.'.length);
  });

  test('file without frontmatter falls back to directory name, no crash', () => {
    assert.ok(byName.has('broken-skill'));
    assert.strictEqual(byName.get('broken-skill').description, '');
  });

  test('parseFrontmatter returns null without frontmatter', () => {
    assert.strictEqual(parseFrontmatter('# just markdown'), null);
  });
}

// ----------------------------------------------------- seed + stats + server

console.log('\nseed + stats API');
{
  const dataDir = tempDir('seed');
  const claudeHome = tempDir('claude-empty');

  test('seed-demo populates ~200 events and demo skills', () => {
    const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seed-demo.js')], {
      env: { ...process.env, SKILLSCOPE_DIR: dataDir },
      encoding: 'utf8',
    });
    assert.match(output, /Seeded \d+ events/);
    const db = openTestDb(dataDir);
    const events = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    const skills = db.prepare('SELECT COUNT(*) AS n FROM skills').get().n;
    db.close();
    assert.ok(events >= 150 && events <= 600, `expected roughly 200+ events, got ${events}`);
    assert.strictEqual(skills, 11);
  });

  test('computeStats returns sane numbers from seeded DB', () => {
    process.env.SKILLSCOPE_DIR = dataDir;
    const { openDb } = require(path.join(ROOT, 'src', 'db'));
    const { computeStats } = require(path.join(ROOT, 'src', 'stats'));
    const db = openDb();
    const stats = computeStats(db);
    db.close();
    assert.strictEqual(stats.totals.skills_installed, 11);
    assert.strictEqual(stats.totals.skills_never_fired, 4);
    assert.ok(stats.totals.total_fires_30d > 0);
    assert.ok(stats.totals.metadata_tax_per_session_tokens > 0);
    assert.strictEqual(stats.activity.length, 30);
    assert.ok(stats.dead_weight.every((skill) => skill.fires === 0));
    assert.ok(stats.most_used_30d.length > 0);
    const fired = stats.skills.find((skill) => skill.name === 'commit-helper');
    assert.ok(fired.fires > 0);
    assert.ok(fired.sessions_with_fire > 0 && fired.sessions_with_fire <= fired.fires);
    assert.strictEqual(fired.total_tokens_consumed, fired.fires * fired.cost_per_load_tokens);
  });

  test('GET /api/stats and GET / serve over HTTP', async () => {
    process.env.SKILLSCOPE_DIR = dataDir;
    process.env.SKILLSCOPE_CLAUDE_DIR = claudeHome;
    const { startServer } = require(path.join(ROOT, 'src', 'server'));
    await new Promise((resolve, reject) => {
      startServer(43210, async (port, server) => {
        try {
          const stats = await (await fetch(`http://127.0.0.1:${port}/api/stats`)).json();
          assert.strictEqual(stats.totals.skills_installed, 11);
          const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
          assert.ok(html.includes('SkillScope') || html.includes('Skill<span'));
          // Port fallback: a second server on the same preferred port must move up.
          await new Promise((resolve2) => {
            startServer(port, (port2, server2) => {
              assert.notStrictEqual(port2, port);
              server2.close();
              resolve2();
            });
          });
          server.close();
          resolve();
        } catch (error) {
          server.close();
          reject(error);
        }
      });
    });
    delete process.env.SKILLSCOPE_CLAUDE_DIR;
  });
}

// --------------------------------------------------------------------- done

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
