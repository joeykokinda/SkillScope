'use strict';

// Surgical install/uninstall of skillscope hooks in Claude Code settings.json.
// Never clobbers anything: existing settings and hooks are preserved, and a
// timestamped backup is written before any modification.

const fs = require('node:fs');
const path = require('node:path');
const { settingsPath } = require('./db');

const HOOK_MARKER = 'skillscope';
const COLLECTOR_PATH = path.join(__dirname, 'collect.js');

const HOOK_EVENTS = [
  // Only Skill and Read tool results matter for detection; the matcher keeps
  // the collector from running on every single tool call.
  { event: 'PostToolUse', matcher: 'Skill|Read' },
  { event: 'SessionStart', matcher: null },
  { event: 'SessionEnd', matcher: null },
  { event: 'UserPromptSubmit', matcher: null },
];

function hookCommand() {
  return `node "${COLLECTOR_PATH}" # ${HOOK_MARKER}`;
}

function isSkillscopeHook(hook) {
  return (
    hook &&
    typeof hook.command === 'string' &&
    hook.command.includes(HOOK_MARKER) &&
    hook.command.includes('collect.js')
  );
}

// Pure merge: returns a new settings object with skillscope hooks added.
// Idempotent: existing skillscope entries are replaced, not duplicated.
function mergeHooks(settings) {
  const merged = JSON.parse(JSON.stringify(settings || {}));
  if (typeof merged.hooks !== 'object' || merged.hooks === null || Array.isArray(merged.hooks)) {
    merged.hooks = {};
  }
  for (const { event, matcher } of HOOK_EVENTS) {
    let groups = merged.hooks[event];
    if (!Array.isArray(groups)) groups = [];
    groups = stripSkillscope(groups);
    const group = { hooks: [{ type: 'command', command: hookCommand() }] };
    if (matcher) group.matcher = matcher;
    groups.push(group);
    merged.hooks[event] = groups;
  }
  return merged;
}

function stripSkillscope(groups) {
  const kept = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const remaining = group.hooks.filter((hook) => !isSkillscopeHook(hook));
    if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    else if (group.hooks.length === 0) kept.push(group);
    // Groups that contained only skillscope hooks are dropped entirely.
  }
  return kept;
}

// Pure removal: returns a new settings object with all skillscope hooks gone.
function removeHooks(settings) {
  const cleaned = JSON.parse(JSON.stringify(settings || {}));
  if (typeof cleaned.hooks !== 'object' || cleaned.hooks === null) return cleaned;
  for (const event of Object.keys(cleaned.hooks)) {
    if (!Array.isArray(cleaned.hooks[event])) continue;
    cleaned.hooks[event] = stripSkillscope(cleaned.hooks[event]);
    if (cleaned.hooks[event].length === 0) delete cleaned.hooks[event];
  }
  if (Object.keys(cleaned.hooks).length === 0) delete cleaned.hooks;
  return cleaned;
}

function readSettingsFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Could not parse ${filePath}: ${error.message}. Fix or move it, then retry.`);
  }
}

function backupSettingsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.skillscope-backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function installHooks() {
  const filePath = settingsPath();
  const settings = readSettingsFile(filePath);
  const backupPath = backupSettingsFile(filePath);
  const merged = mergeHooks(settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
  return { filePath, backupPath };
}

function uninstallHooks() {
  const filePath = settingsPath();
  const settings = readSettingsFile(filePath);
  const backupPath = backupSettingsFile(filePath);
  const cleaned = removeHooks(settings);
  fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2) + '\n');
  return { filePath, backupPath };
}

module.exports = { mergeHooks, removeHooks, installHooks, uninstallHooks, hookCommand, HOOK_EVENTS };
