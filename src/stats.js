'use strict';

// Shared queries powering `skillscope status` and GET /api/stats.
// Token estimates everywhere are chars / 4.

const DAY_MS = 24 * 60 * 60 * 1000;

function estimateTokens(chars) {
  return Math.ceil((chars || 0) / 4);
}

function computeStats(db, now) {
  now = now || Date.now();
  const since30d = now - 30 * DAY_MS;

  const skills = db.prepare('SELECT * FROM skills ORDER BY name').all();

  const fireRows = db
    .prepare(
      `SELECT skill_name,
              COUNT(*) AS fires,
              COUNT(DISTINCT session_id) AS sessions,
              MAX(ts) AS last_fired
       FROM events
       WHERE event_type = 'skill_fired' AND skill_name IS NOT NULL
       GROUP BY skill_name`
    )
    .all();
  const firesBySkill = new Map(fireRows.map((row) => [row.skill_name, row]));

  const fires30dRows = db
    .prepare(
      `SELECT skill_name, COUNT(*) AS fires
       FROM events
       WHERE event_type = 'skill_fired' AND skill_name IS NOT NULL AND ts >= ?
       GROUP BY skill_name
       ORDER BY fires DESC`
    )
    .all(since30d);
  const fires30dBySkill = new Map(fires30dRows.map((row) => [row.skill_name, row.fires]));

  const totalFires30d = fires30dRows.reduce((sum, row) => sum + row.fires, 0);

  const sessionsObserved = db
    .prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE session_id IS NOT NULL`)
    .get().n;
  const prompts30d = db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'prompt' AND ts >= ?`)
    .get(since30d).n;

  // Fires per day, last 30 days, zero-filled.
  const perDayRows = db
    .prepare(
      `SELECT date(ts / 1000, 'unixepoch') AS day, COUNT(*) AS fires
       FROM events
       WHERE event_type = 'skill_fired' AND ts >= ?
       GROUP BY day`
    )
    .all(since30d);
  const perDayMap = new Map(perDayRows.map((row) => [row.day, row.fires]));
  const activity = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    activity.push({ day, fires: perDayMap.get(day) || 0 });
  }

  const skillRows = skills.map((skill) => {
    const allTime = firesBySkill.get(skill.name);
    const costPerLoadTokens = estimateTokens(skill.skill_md_chars);
    const fires = allTime ? allTime.fires : 0;
    return {
      name: skill.name,
      description: skill.description || '',
      scope: skill.scope,
      path: skill.path,
      fires,
      fires_30d: fires30dBySkill.get(skill.name) || 0,
      sessions_with_fire: allTime ? allTime.sessions : 0,
      last_fired: allTime ? allTime.last_fired : null,
      cost_per_load_tokens: costPerLoadTokens,
      metadata_tax_tokens: estimateTokens(skill.metadata_chars),
      total_tokens_consumed: fires * costPerLoadTokens,
    };
  });

  const neverFired = skillRows
    .filter((skill) => skill.fires === 0)
    .sort((a, b) => b.metadata_tax_tokens - a.metadata_tax_tokens);

  const metadataTaxPerSession = skillRows.reduce((sum, skill) => sum + skill.metadata_tax_tokens, 0);

  return {
    generated_at: now,
    totals: {
      skills_installed: skillRows.length,
      skills_never_fired: neverFired.length,
      total_fires_30d: totalFires30d,
      metadata_tax_per_session_tokens: metadataTaxPerSession,
      sessions_observed: sessionsObserved,
      prompts_30d: prompts30d,
    },
    skills: skillRows,
    dead_weight: neverFired,
    most_used_30d: skillRows
      .filter((skill) => skill.fires_30d > 0)
      .sort((a, b) => b.fires_30d - a.fires_30d)
      .slice(0, 15),
    activity,
  };
}

module.exports = { computeStats, estimateTokens };
