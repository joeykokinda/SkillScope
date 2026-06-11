#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { openDb, dbPath } = require('./db');
const { installHooks, uninstallHooks } = require('./settings');
const { scanIntoDb } = require('./scan');
const { computeStats } = require('./stats');
const { startServer, DEFAULT_PORT } = require('./server');

function formatTokens(tokens) {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function commandInit() {
  const { filePath, backupPath } = installHooks();
  const skills = scanIntoDb();
  console.log('skillscope installed.');
  console.log(`  hooks merged into: ${filePath}`);
  if (backupPath) console.log(`  backup saved:      ${backupPath}`);
  console.log(`  skills found:      ${skills.length}`);
  console.log(`  database:          ${dbPath()}`);
  console.log('');
  console.log('Now just use Claude Code normally. Events are collected silently.');
  console.log('After a few sessions, run: skillscope dashboard');
}

function commandStatus() {
  const db = openDb();
  try {
    scanIntoDb(db);
    const stats = computeStats(db);
    const { totals } = stats;
    const neverFiredPct =
      totals.skills_installed > 0
        ? Math.round((totals.skills_never_fired / totals.skills_installed) * 100)
        : 0;
    console.log('skillscope status');
    console.log(`  skills installed:        ${totals.skills_installed}`);
    console.log(`  never fired:             ${totals.skills_never_fired} (${neverFiredPct}%)`);
    console.log(`  fires (30d):             ${totals.total_fires_30d}`);
    console.log(`  sessions observed:       ${totals.sessions_observed}`);
    console.log(`  metadata tax / session:  ~${formatTokens(totals.metadata_tax_per_session_tokens)} tokens`);
    console.log('');
    console.log('  top skills (30d):');
    const top = stats.most_used_30d.slice(0, 5);
    if (top.length === 0) {
      console.log('    (no skill fires recorded yet)');
    }
    for (const skill of top) {
      console.log(`    ${String(skill.fires_30d).padStart(4)}x  ${skill.name} [${skill.scope}]`);
    }
  } finally {
    db.close();
  }
}

function commandDashboard() {
  startServer(DEFAULT_PORT, (port) => {
    const url = `http://localhost:${port}`;
    console.log(`skillscope dashboard: ${url}`);
    console.log('Ctrl+C to stop.');
    openBrowser(url);
  });
}

function openBrowser(url) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available; the printed URL is enough.
  }
}

function commandUninstall() {
  const { filePath, backupPath } = uninstallHooks();
  console.log('skillscope hooks removed.');
  console.log(`  cleaned:      ${filePath}`);
  if (backupPath) console.log(`  backup saved: ${backupPath}`);
  console.log(`  database kept at ${dbPath()} (delete it manually if you want)`);
}

function help() {
  console.log(`skillscope - skill observability for Claude Code

Usage:
  skillscope init        install hooks into ~/.claude/settings.json (merge, with backup)
  skillscope dashboard   open the local dashboard (http://localhost:${DEFAULT_PORT})
  skillscope status      print a terminal summary
  skillscope uninstall   remove skillscope hooks (keeps the database)

Everything is local. No network calls. Prompt text is never stored.`);
}

const command = process.argv[2];
switch (command) {
  case 'init':
    commandInit();
    break;
  case 'dashboard':
    commandDashboard();
    break;
  case 'status':
    commandStatus();
    break;
  case 'uninstall':
    commandUninstall();
    break;
  default:
    help();
    process.exitCode = command ? 1 : 0;
}
