#!/usr/bin/env node
'use strict';

// Hook collector. Reads one Claude Code hook payload (JSON) from stdin,
// writes event rows to SQLite, and ALWAYS exits 0. Never blocks the agent:
// no network, swallow every error, hard self-destruct timer as a backstop.

const SKILL_MD_PATTERN = /[/\\]skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i;

function extractSkillNameFromToolUse(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolName === 'Skill') {
    const candidate = toolInput.skill || toolInput.skill_name || toolInput.name || toolInput.command;
    if (typeof candidate === 'string' && candidate.length > 0) {
      // Plugin-namespaced invocations look like "plugin:skill"; keep the skill part.
      const bare = candidate.split(':').pop().trim();
      return bare || null;
    }
    return null;
  }
  if (toolName === 'Read') {
    const filePath = toolInput.file_path || toolInput.path || toolInput.notebook_path;
    if (typeof filePath === 'string') {
      const match = filePath.match(SKILL_MD_PATTERN);
      if (match) return match[1];
    }
    return null;
  }
  return null;
}

// Maps one hook payload to event rows (usually 0 or 1).
function payloadToEvents(payload, now) {
  if (!payload || typeof payload !== 'object') return [];
  const base = {
    ts: now,
    session_id: typeof payload.session_id === 'string' ? payload.session_id : null,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
  };
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return [{ ...base, event_type: 'session_start', skill_name: null, tool_name: null }];
    case 'SessionEnd':
      return [{ ...base, event_type: 'session_end', skill_name: null, tool_name: null }];
    case 'UserPromptSubmit':
      // Count only. Prompt text is never read or stored.
      return [{ ...base, event_type: 'prompt', skill_name: null, tool_name: null }];
    case 'PostToolUse': {
      const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
      const skillName = extractSkillNameFromToolUse(toolName, payload.tool_input);
      if (skillName) {
        return [{ ...base, event_type: 'skill_fired', skill_name: skillName, tool_name: toolName }];
      }
      return [];
    }
    default:
      return [];
  }
}

function record(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return;
  }
  const events = payloadToEvents(payload, Date.now());
  if (events.length === 0) return;
  const { openDb } = require('./db');
  const db = openDb();
  try {
    const insert = db.prepare(
      'INSERT INTO events (ts, session_id, event_type, skill_name, tool_name, cwd) VALUES (@ts, @session_id, @event_type, @skill_name, @tool_name, @cwd)'
    );
    for (const event of events) insert.run(event);
  } finally {
    db.close();
  }
}

function main() {
  // Backstop: never outlive the hook timeout even if stdin stalls.
  const killTimer = setTimeout(() => process.exit(0), 4000);
  killTimer.unref();

  let rawInput = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    rawInput += chunk;
    if (rawInput.length > 10 * 1024 * 1024) process.exit(0);
  });
  process.stdin.on('end', () => {
    try {
      record(rawInput);
    } catch {
      // Telemetry must never break the agent.
    }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { payloadToEvents, extractSkillNameFromToolUse };
