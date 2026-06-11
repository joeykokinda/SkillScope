#!/usr/bin/env node
'use strict';

// Skill inventory scanner. Finds installed skills (user, project, plugin),
// parses SKILL.md frontmatter, and upserts them into the skills table.

const fs = require('node:fs');
const path = require('node:path');
const { openDb, claudeDir } = require('./db');

// Minimal YAML frontmatter parser: top-level `key: value` lines only.
// Skill frontmatter in the wild is flat (name, description, etc.), so this
// covers real files without a YAML dependency. Returns null if no frontmatter.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fields[kv[1]] = value;
  }
  return fields;
}

function readSkillFile(skillMdPath, scope) {
  let content;
  try {
    content = fs.readFileSync(skillMdPath, 'utf8');
  } catch {
    return null;
  }
  let name = path.basename(path.dirname(skillMdPath));
  let description = '';
  try {
    const fm = parseFrontmatter(content);
    if (fm) {
      if (typeof fm.name === 'string' && fm.name) name = fm.name;
      if (typeof fm.description === 'string') description = fm.description;
    }
  } catch {
    // Broken frontmatter: fall back to directory name, keep going.
  }
  return {
    name,
    description,
    path: skillMdPath,
    scope,
    skill_md_chars: content.length,
    metadata_chars: name.length + description.length,
  };
}

function skillDirsIn(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name, 'SKILL.md');
    if (fs.existsSync(candidate)) found.push(candidate);
  }
  return found;
}

function pluginSkillRoots() {
  const roots = [];
  // Primary source: installed_plugins.json points at each plugin's installPath.
  try {
    const manifestPath = path.join(claudeDir(), 'plugins', 'installed_plugins.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const plugins = manifest && manifest.plugins ? manifest.plugins : {};
    for (const installs of Object.values(plugins)) {
      if (!Array.isArray(installs)) continue;
      for (const install of installs) {
        if (install && typeof install.installPath === 'string') {
          roots.push(path.join(install.installPath, 'skills'));
        }
      }
    }
  } catch {
    // Manifest missing or unparseable: fall back to walking the cache dir.
  }
  if (roots.length === 0) {
    const cacheDir = path.join(claudeDir(), 'plugins', 'cache');
    roots.push(...findSkillsDirs(cacheDir, 4));
  }
  return roots;
}

// Defensive bounded walk for `**/skills/` directories (plugin layouts vary).
function findSkillsDirs(root, maxDepth) {
  if (maxDepth < 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === 'skills') found.push(full);
    else if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      found.push(...findSkillsDirs(full, maxDepth - 1));
    }
  }
  return found;
}

function discoverSkills(projectDirs) {
  const skills = [];
  for (const skillMd of skillDirsIn(path.join(claudeDir(), 'skills'))) {
    const skill = readSkillFile(skillMd, 'user');
    if (skill) skills.push(skill);
  }
  for (const projectDir of projectDirs || []) {
    for (const skillMd of skillDirsIn(path.join(projectDir, '.claude', 'skills'))) {
      const skill = readSkillFile(skillMd, 'project');
      if (skill) skills.push(skill);
    }
  }
  for (const root of pluginSkillRoots()) {
    for (const skillMd of skillDirsIn(root)) {
      const skill = readSkillFile(skillMd, 'plugin');
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

// Scans everything and syncs the skills table. Project dirs come from
// distinct cwd values seen in collected events.
function scanIntoDb(db) {
  const ownedDb = !db;
  if (ownedDb) db = openDb();
  try {
    const projectDirs = db
      .prepare('SELECT DISTINCT cwd FROM events WHERE cwd IS NOT NULL')
      .all()
      .map((row) => row.cwd);
    const skills = discoverSkills(projectDirs);
    const now = Date.now();
    const upsert = db.prepare(`
      INSERT INTO skills (name, description, path, scope, skill_md_chars, metadata_chars, first_seen, last_scanned)
      VALUES (@name, @description, @path, @scope, @skill_md_chars, @metadata_chars, @now, @now)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        path = excluded.path,
        scope = excluded.scope,
        skill_md_chars = excluded.skill_md_chars,
        metadata_chars = excluded.metadata_chars,
        last_scanned = excluded.last_scanned
    `);
    const sync = db.transaction((found) => {
      for (const skill of found) upsert.run({ ...skill, now });
    });
    sync(skills);
    return skills;
  } finally {
    if (ownedDb) db.close();
  }
}

if (require.main === module) {
  const skills = scanIntoDb();
  console.log(`Scanned ${skills.length} skill(s).`);
  for (const skill of skills) console.log(`  [${skill.scope}] ${skill.name}`);
}

module.exports = { parseFrontmatter, readSkillFile, discoverSkills, scanIntoDb };
