#!/usr/bin/env node
// neurotoken-grader.mjs — A/B test grading script
// Reads JSONL log from two test sessions (A=control, B=treatment),
// compares classifications against expected tiers from the test protocol,
// and outputs a markdown comparison report.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Test Protocol ──────────────────────────────────────────────────

const PROTOCOL = [
  // Block 1 — Trivial/Routine
  { id: 1,  prompt: 'Rename getUserData to fetchUserData',              expected: 'haiku/low',   block: 'Trivial' },
  { id: 2,  prompt: 'What does this function do?',                      expected: 'haiku/low',   block: 'Trivial' },
  { id: 3,  prompt: 'Format this JSON for me',                          expected: 'haiku/low',   block: 'Trivial' },
  { id: 4,  prompt: 'Add a TODO comment at line 42',                    expected: 'haiku/low',   block: 'Trivial' },
  // Block 2 — Standard Coding
  { id: 5,  prompt: 'Add a loading spinner to the dashboard page',      expected: 'sonnet/med',  block: 'Standard' },
  { id: 6,  prompt: 'Fix this TypeScript error',                        expected: 'sonnet/med',  block: 'Standard' },
  { id: 7,  prompt: 'Write a Zustand store for notification preferences', expected: 'sonnet/med', block: 'Standard' },
  { id: 8,  prompt: 'Refactor this component to use React hooks',       expected: 'sonnet/med',  block: 'Standard' },
  // Block 3 — Complex Architecture
  { id: 9,  prompt: 'Design the data model for a real-time leaderboard with offline-first sync', expected: 'opus/med', block: 'Complex' },
  { id: 10, prompt: 'How should we structure the WebSocket reconnection logic across 3 services', expected: 'opus/med', block: 'Complex' },
  { id: 11, prompt: 'Plan the migration from REST to GraphQL for the API layer', expected: 'opus/med', block: 'Complex' },
  // Block 4 — High-Stakes/Security
  { id: 12, prompt: 'Review and fix the RLS policies on the users table', expected: 'opus/high', block: 'Security' },
  { id: 13, prompt: 'Add authentication to this API endpoint that handles payment data', expected: 'opus/high', block: 'Security' },
  { id: 14, prompt: 'Deploy the database migration that changes the auth schema', expected: 'opus/max',  block: 'Security' },
  // Block 5 — Multi-Turn
  { id: 15, prompt: 'ok do it',                                         expected: 'opus/med',    block: 'MultiTurn', note: 'After auth middleware discussion — HWM should prevent collapse' },
  { id: 16, prompt: 'make that change',                                 expected: 'sonnet/high', block: 'MultiTurn', note: 'After token refresh analysis — HWM should prevent collapse' },
  // Block 6 — Orchestrator
  { id: 17, prompt: 'Run a full security review of the auth module then generate tests', expected: 'opus/high', block: 'Orchestrator' },
  { id: 18, prompt: 'Scout for new job listings research the top 3 and draft applications', expected: 'sonnet/med', block: 'Orchestrator' },
];

const TIER_ORDER = [
  'haiku/low', 'haiku/med', 'haiku/high', 'sonnet/low', 'sonnet/med',
  'sonnet/high', 'sonnet/max', 'opus/low', 'opus/med', 'opus/high', 'opus/max',
];

// ── Helpers ────────────────────────────────────────────────────────

function tierIndex(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? null : idx;
}

function tierDistance(actual, expected) {
  const a = tierIndex(actual);
  const e = tierIndex(expected);
  if (a === null || e === null) return null;
  return a - e;
}

function direction(distance) {
  if (distance === null) return 'unknown';
  if (distance > 0) return 'over';
  if (distance < 0) return 'under';
  return 'exact';
}

/**
 * Fuzzy-match a log entry's prompt_preview to a protocol task.
 * Uses first 30 chars (lowercased, trimmed) comparison.
 * Returns the matched protocol entry or null.
 */
function matchToProtocol(entry, usedIds) {
  const preview = (entry.prompt_preview || '').toLowerCase().trim();
  const previewPrefix = preview.slice(0, 30);

  let bestMatch = null;
  let bestScore = 0;

  for (const task of PROTOCOL) {
    if (usedIds.has(task.id)) continue;

    const taskPrefix = task.prompt.toLowerCase().trim().slice(0, 30);

    // Exact prefix match
    if (previewPrefix === taskPrefix) {
      bestMatch = task;
      bestScore = Infinity;
      break;
    }

    // Partial overlap: count shared characters from the start
    let shared = 0;
    const minLen = Math.min(previewPrefix.length, taskPrefix.length);
    for (let i = 0; i < minLen; i++) {
      if (previewPrefix[i] === taskPrefix[i]) shared++;
      else break;
    }

    // Require at least 10 chars of shared prefix to consider a match
    if (shared >= 10 && shared > bestScore) {
      bestScore = shared;
      bestMatch = task;
    }
  }

  return bestMatch;
}

/**
 * Truncate a string to a max length with ellipsis.
 */
function truncate(str, maxLen = 40) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Pad/align a string for table columns.
 */
function pad(str, len) {
  return String(str).padEnd(len);
}

// ── Main ───────────────────────────────────────────────────────────

const mismatchesOnly = process.argv.includes('--mismatches-only');
const outcomeFlags = process.argv.includes('--outcome-flags');
const logPath = join(tmpdir(), 'neurotoken-log.jsonl');

// Read log file
let rawLog;
try {
  rawLog = readFileSync(logPath, 'utf8');
} catch {
  console.error(`No log file found at ${logPath}`);
  process.exit(1);
}

// Parse JSONL entries
const entries = rawLog
  .split('\n')
  .filter(line => line.trim())
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      console.error(`Warning: could not parse line ${i + 1}, skipping`);
      return null;
    }
  })
  .filter(Boolean);

// Separate by session
const sessionA = entries.filter(e => e.session === 'A');
const sessionB = entries.filter(e => e.session === 'B');

/**
 * Match a session's entries to protocol tasks.
 * Returns { matched: [{ task, entry }], unmatched: [entry] }
 */
function matchSession(sessionEntries) {
  const usedIds = new Set();
  const matched = [];
  const unmatched = [];

  // First pass: try fuzzy matching
  for (const entry of sessionEntries) {
    const task = matchToProtocol(entry, usedIds);
    if (task) {
      usedIds.add(task.id);
      matched.push({ task, entry });
    } else {
      unmatched.push(entry);
    }
  }

  // Second pass: try sequence-order matching for unmatched entries
  // If prompts were run in order, assign unmatched entries to remaining tasks
  if (unmatched.length > 0) {
    const remainingTasks = PROTOCOL.filter(t => !usedIds.has(t.id)).sort((a, b) => a.id - b.id);
    const stillUnmatched = [];

    for (const entry of unmatched) {
      if (remainingTasks.length > 0) {
        const task = remainingTasks.shift();
        usedIds.add(task.id);
        matched.push({ task, entry });
      } else {
        stillUnmatched.push(entry);
      }
    }

    return { matched, unmatched: stillUnmatched };
  }

  return { matched, unmatched };
}

const resultA = matchSession(sessionA);
const resultB = matchSession(sessionB);

// Build a map: taskId -> { taskA, taskB } for comparison
const taskResults = new Map();

for (const { task, entry } of resultA.matched) {
  if (!taskResults.has(task.id)) {
    taskResults.set(task.id, { task, entryA: null, entryB: null });
  }
  taskResults.get(task.id).entryA = entry;
}

for (const { task, entry } of resultB.matched) {
  if (!taskResults.has(task.id)) {
    taskResults.set(task.id, { task, entryA: null, entryB: null });
  }
  taskResults.get(task.id).entryB = entry;
}

// Compute per-task metrics
const taskMetrics = [];
for (const [id, { task, entryA, entryB }] of [...taskResults.entries()].sort((a, b) => a[0] - b[0])) {
  const metrics = { task, entryA, entryB, metricsA: null, metricsB: null };

  for (const [key, entry] of [['metricsA', entryA], ['metricsB', entryB]]) {
    if (!entry) continue;
    const dist = tierDistance(entry.tier, task.expected);
    metrics[key] = {
      actual: entry.tier,
      expected: task.expected,
      distance: dist,
      absDist: dist !== null ? Math.abs(dist) : null,
      match: dist !== null ? Math.abs(dist) <= 1 : false,
      direction: direction(dist),
      hwm_applied: entry.hwm_applied || false,
      mods: entry.mods || [],
    };
  }

  taskMetrics.push(metrics);
}

// ── Aggregate Metrics ──────────────────────────────────────────────

function computeAggregates(metricsKey) {
  const relevant = taskMetrics.filter(m => m[metricsKey] !== null);
  if (relevant.length === 0) return null;

  const total = relevant.length;
  const aligned = relevant.filter(m => m[metricsKey].match).length;
  const exact = relevant.filter(m => m[metricsKey].distance === 0).length;
  const over = relevant.filter(m => m[metricsKey].direction === 'over').length;
  const under = relevant.filter(m => m[metricsKey].direction === 'under').length;

  return {
    total,
    alignment: ((aligned / total) * 100).toFixed(1),
    exactRate: ((exact / total) * 100).toFixed(1),
    overRate: ((over / total) * 100).toFixed(1),
    underRate: ((under / total) * 100).toFixed(1),
  };
}

const aggA = computeAggregates('metricsA');
const aggB = computeAggregates('metricsB');

// Use the best available session for the verdict, preferring B (treatment)
const primaryAgg = aggB || aggA;

function verdict(agg) {
  if (!agg) return 'NO DATA — no matched entries';
  const alg = parseFloat(agg.alignment);
  if (alg >= 90) return 'PASS — ready to ship';
  if (alg >= 75) return 'NEEDS TUNING';
  return 'FAIL — rethink signals';
}

// ── Modifier Audit ─────────────────────────────────────────────────

const modifierMap = new Map();
for (const m of taskMetrics) {
  for (const [key, entry] of [['metricsA', m.entryA], ['metricsB', m.entryB]]) {
    const metrics = m[key];
    if (!metrics) continue;
    for (const mod of metrics.mods) {
      if (!modifierMap.has(mod)) modifierMap.set(mod, []);
      modifierMap.get(mod).push(m.task.id);
    }
  }
}

// ── HWM Audit ──────────────────────────────────────────────────────

function hwmAuditLine(taskId) {
  const m = taskMetrics.find(tm => tm.task.id === taskId);
  if (!m) return `- Task ${taskId}: NOT FOUND in results`;

  const lines = [];
  for (const [label, key] of [['A', 'metricsA'], ['B', 'metricsB']]) {
    const metrics = m[key];
    if (!metrics) {
      lines.push(`  - Session ${label}: no data`);
      continue;
    }
    const tierIdx = tierIndex(metrics.actual);
    const haikuMedIdx = tierIndex('haiku/med');
    const pass = tierIdx !== null && tierIdx > haikuMedIdx;
    lines.push(`  - Session ${label}: tier=${metrics.actual}, hwm_applied=${metrics.hwm_applied} — ${pass ? 'PASS' : 'FAIL'}`);
  }

  return `- Task ${taskId} "${truncate(m.task.prompt, 30)}":\n${lines.join('\n')}`;
}

// ── Misclassifications ─────────────────────────────────────────────

function getMisclassifications() {
  const misses = [];
  for (const m of taskMetrics) {
    for (const [label, key] of [['A', 'metricsA'], ['B', 'metricsB']]) {
      const metrics = m[key];
      if (!metrics) continue;
      if (metrics.absDist !== null && metrics.absDist > 1) {
        misses.push({
          taskId: m.task.id,
          block: m.task.block,
          prompt: m.task.prompt,
          session: label,
          expected: metrics.expected,
          actual: metrics.actual,
          distance: metrics.distance,
          direction: metrics.direction,
          mods: metrics.mods,
        });
      }
    }
  }
  return misses;
}

const misclassifications = getMisclassifications();

// ── Tuning Recommendations ─────────────────────────────────────────

function tuningRecommendation(miss) {
  const { direction: dir, expected, actual, block, prompt, distance } = miss;
  const absDist = Math.abs(distance);

  if (dir === 'over') {
    // Over-classified: signals are too aggressive
    if (block === 'Trivial') {
      return `Reduce signal weight for terms in "${truncate(prompt, 50)}". Consider adding de-escalation for simple verbs like rename/format/add comment.`;
    }
    return `Over-classified by ${absDist} tiers (${expected} -> ${actual}). Check if complexity or stakes signals are double-counting for this prompt pattern.`;
  }

  if (dir === 'under') {
    if (block === 'MultiTurn') {
      return `HWM decay may be too aggressive or not firing. Verify HWM file freshness and that multi-turn context is preserved within the 5-minute window.`;
    }
    if (block === 'Security') {
      return `Under-classified security task by ${absDist} tiers (${expected} -> ${actual}). Consider increasing stakes phrase weights for auth/RLS/payment-related terms.`;
    }
    if (block === 'Complex') {
      return `Under-classified complex task by ${absDist} tiers (${expected} -> ${actual}). Consider adding complexity phrases for the specific architectural concepts in this prompt.`;
    }
    return `Under-classified by ${absDist} tiers (${expected} -> ${actual}). Add or strengthen signal keywords that should trigger for "${truncate(prompt, 50)}".`;
  }

  return `Distance ${distance} from expected. Review signal weights.`;
}

// ── Report Generation ──────────────────────────────────────────────

function generateReport() {
  const now = new Date().toISOString();
  const lines = [];

  lines.push('# Neurotoken A/B Test Report');
  lines.push(`Generated: ${now}`);
  lines.push('');

  // ── Summary ──
  lines.push('## Summary');
  lines.push(`- Session A entries: ${sessionA.length}`);
  lines.push(`- Session B entries: ${sessionB.length}`);

  if (aggA) {
    lines.push(`- Session A alignment (+/-1 tier): ${aggA.alignment}%`);
    lines.push(`- Session A exact match rate: ${aggA.exactRate}%`);
    lines.push(`- Session A over-classification: ${aggA.overRate}%`);
    lines.push(`- Session A under-classification: ${aggA.underRate}%`);
  } else {
    lines.push('- Session A: no matched entries');
  }

  if (aggB) {
    lines.push(`- Session B alignment (+/-1 tier): ${aggB.alignment}%`);
    lines.push(`- Session B exact match rate: ${aggB.exactRate}%`);
    lines.push(`- Session B over-classification: ${aggB.overRate}%`);
    lines.push(`- Session B under-classification: ${aggB.underRate}%`);
  } else {
    lines.push('- Session B: no matched entries');
  }

  lines.push('');

  // ── Verdict ──
  lines.push('## Verdict');
  lines.push('');
  lines.push('> **Note**: This grader measures *classification alignment* — whether scores match design intent.');
  lines.push('> It does NOT measure outcome quality (response helpfulness, token efficiency, error rates).');
  lines.push('> Outcome validation requires manual review of Session A vs B responses for the same tasks.');
  lines.push('');
  if (aggA) lines.push(`- Session A: ${verdict(aggA)}`);
  if (aggB) lines.push(`- Session B: ${verdict(aggB)}`);
  if (!aggA && !aggB) lines.push('NO DATA — no matched entries in either session');
  lines.push('');

  // ── Task-by-Task ──
  if (!mismatchesOnly) {
    lines.push('## Task-by-Task Comparison');
    lines.push('');
    lines.push('| # | Block | Prompt | Expected | Session A | Session B | Dist A | Dist B | Match A | Match B |');
    lines.push('|---|-------|--------|----------|-----------|-----------|--------|--------|---------|---------|');

    for (const m of taskMetrics) {
      const t = m.task;
      const mA = m.metricsA;
      const mB = m.metricsB;

      const actualA = mA ? mA.actual : '—';
      const actualB = mB ? mB.actual : '—';
      const distA = mA && mA.distance !== null ? String(mA.distance) : '—';
      const distB = mB && mB.distance !== null ? String(mB.distance) : '—';
      const matchA = mA ? (mA.match ? 'yes' : 'NO') : '—';
      const matchB = mB ? (mB.match ? 'yes' : 'NO') : '—';

      lines.push(`| ${t.id} | ${t.block} | ${truncate(t.prompt, 45)} | ${t.expected} | ${actualA} | ${actualB} | ${distA} | ${distB} | ${matchA} | ${matchB} |`);
    }
    lines.push('');
  }

  // ── HWM Audit ──
  lines.push('## HWM Audit (Tasks 15-16)');
  lines.push(hwmAuditLine(15));
  lines.push(hwmAuditLine(16));
  lines.push('');

  // ── Modifier Audit ──
  lines.push('## Modifier Audit');
  lines.push('');
  if (modifierMap.size === 0) {
    lines.push('No modifiers fired during the test.');
  } else {
    lines.push('| Modifier | Times Fired | Tasks |');
    lines.push('|----------|-------------|-------|');
    for (const [mod, taskIds] of [...modifierMap.entries()].sort()) {
      const unique = [...new Set(taskIds)].sort((a, b) => a - b);
      lines.push(`| ${mod} | ${unique.length} | ${unique.join(', ')} |`);
    }
  }
  lines.push('');

  // ── Misclassifications ──
  lines.push('## Misclassifications (distance > 1)');
  lines.push('');
  if (misclassifications.length === 0) {
    lines.push('None — all tasks within acceptable range.');
  } else {
    for (const miss of misclassifications) {
      lines.push(`- **Task ${miss.taskId}** (${miss.block}, Session ${miss.session}): expected ${miss.expected}, got ${miss.actual} (distance ${miss.distance}, ${miss.direction})`);
      if (miss.mods.length > 0) {
        lines.push(`  - Modifiers: ${miss.mods.join(', ')}`);
      }
    }
  }
  lines.push('');

  // ── Tuning Recommendations ──
  lines.push('## Tuning Recommendations');
  lines.push('');
  if (misclassifications.length === 0) {
    lines.push('No tuning needed — all classifications within acceptable range.');
  } else {
    for (const miss of misclassifications) {
      lines.push(`- **Task ${miss.taskId}** (Session ${miss.session}): ${tuningRecommendation(miss)}`);
    }
  }
  lines.push('');

  // ── Outcome Signals ──
  lines.push('## Outcome Signals (Manual Review Required)');
  lines.push('');
  lines.push('These metrics flag entries that warrant manual review to assess real-world impact:');
  lines.push('');

  // Over-classification Risk: actual tier 2+ steps above expected
  lines.push('### Over-classification Risk');
  const overRisks = taskMetrics.filter(m => {
    for (const key of ['metricsA', 'metricsB']) {
      const metrics = m[key];
      if (metrics && metrics.distance !== null && metrics.distance >= 2) return true;
    }
    return false;
  });
  if (overRisks.length === 0) {
    lines.push('None — no tasks classified 2+ tiers above expected.');
  } else {
    for (const m of overRisks) {
      for (const [label, key] of [['A', 'metricsA'], ['B', 'metricsB']]) {
        const metrics = m[key];
        if (metrics && metrics.distance !== null && metrics.distance >= 2) {
          lines.push(`- **Task ${m.task.id}** (Session ${label}): expected ${metrics.expected}, got ${metrics.actual} (+${metrics.distance} tiers) — potential resource waste`);
        }
      }
    }
  }
  lines.push('');

  // Under-classification Risk: actual tier 2+ steps below expected
  lines.push('### Under-classification Risk');
  const underRisks = taskMetrics.filter(m => {
    for (const key of ['metricsA', 'metricsB']) {
      const metrics = m[key];
      if (metrics && metrics.distance !== null && metrics.distance <= -2) return true;
    }
    return false;
  });
  if (underRisks.length === 0) {
    lines.push('None — no tasks classified 2+ tiers below expected.');
  } else {
    for (const m of underRisks) {
      for (const [label, key] of [['A', 'metricsA'], ['B', 'metricsB']]) {
        const metrics = m[key];
        if (metrics && metrics.distance !== null && metrics.distance <= -2) {
          lines.push(`- **Task ${m.task.id}** (Session ${label}): expected ${metrics.expected}, got ${metrics.actual} (${metrics.distance} tiers) — potential safety gap`);
        }
      }
    }
  }
  lines.push('');

  // Keyword Density Outliers: raw_c or raw_s > 12
  lines.push('### Keyword Density Outliers');
  const densityOutliers = entries.filter(e => (e.raw_c > 12) || (e.raw_s > 12));
  if (densityOutliers.length === 0) {
    lines.push('None — no entries with raw_c or raw_s > 12.');
  } else {
    for (const e of densityOutliers) {
      lines.push(`- Session ${e.session || '?'}: "${truncate(e.prompt_preview || '(empty)', 50)}" — raw_c=${e.raw_c ?? '?'}, raw_s=${e.raw_s ?? '?'} — likely keyword stuffing`);
    }
  }
  lines.push('');

  // HWM Persistence: sequences where hwm_applied=true for 3+ consecutive entries
  lines.push('### HWM Persistence');
  const hwmChains = [];
  let currentChain = [];
  for (const e of entries) {
    if (e.hwm_applied) {
      currentChain.push(e);
    } else {
      if (currentChain.length >= 3) {
        hwmChains.push([...currentChain]);
      }
      currentChain = [];
    }
  }
  if (currentChain.length >= 3) hwmChains.push([...currentChain]);

  if (hwmChains.length === 0) {
    lines.push('None — no chains of 3+ consecutive HWM-applied entries.');
  } else {
    for (let i = 0; i < hwmChains.length; i++) {
      const chain = hwmChains[i];
      lines.push(`- Chain ${i + 1} (${chain.length} entries):`);
      for (const e of chain) {
        lines.push(`  - Session ${e.session || '?'}: "${truncate(e.prompt_preview || '(empty)', 40)}" -> ${e.tier}`);
      }
    }
  }
  lines.push('');

  // ── Unmatched Entries ──
  const allUnmatched = [
    ...resultA.unmatched.map(e => ({ ...e, _session: 'A' })),
    ...resultB.unmatched.map(e => ({ ...e, _session: 'B' })),
  ];

  if (allUnmatched.length > 0) {
    lines.push('## Unmatched Log Entries');
    lines.push('');
    lines.push('These log entries could not be matched to any protocol task:');
    lines.push('');
    for (const entry of allUnmatched) {
      lines.push(`- Session ${entry._session}: "${truncate(entry.prompt_preview || '(empty)', 60)}" -> ${entry.tier}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Mismatches-Only Mode ───────────────────────────────────────────

function generateMismatchReport() {
  const lines = [];
  lines.push('# Neurotoken Mismatches (distance > 1)');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (misclassifications.length === 0) {
    lines.push('No misclassifications found — all tasks within acceptable range.');
    return lines.join('\n');
  }

  lines.push(`Found ${misclassifications.length} misclassification(s):`);
  lines.push('');

  for (const miss of misclassifications) {
    lines.push(`### Task ${miss.taskId} — ${miss.block} (Session ${miss.session})`);
    lines.push(`- Prompt: ${miss.prompt}`);
    lines.push(`- Expected: ${miss.expected}`);
    lines.push(`- Actual: ${miss.actual}`);
    lines.push(`- Distance: ${miss.distance} (${miss.direction})`);
    if (miss.mods.length > 0) {
      lines.push(`- Modifiers: ${miss.mods.join(', ')}`);
    }
    lines.push(`- Recommendation: ${tuningRecommendation(miss)}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Output ─────────────────────────────────────────────────────────

const report = mismatchesOnly ? generateMismatchReport() : generateReport();

// Write to stdout
console.log(report);

// Write to file (full report only)
if (!mismatchesOnly) {
  const reportPath = join(tmpdir(), 'neurotoken-ab-report.md');
  writeFileSync(reportPath, report);
  console.error(`Report written to ${reportPath}`);
}

// ── Outcome Flags (--outcome-flags) ───────────────────────────────

if (outcomeFlags) {
  const flagLines = [];
  flagLines.push('');
  flagLines.push('# Outcome Flags');
  flagLines.push(`Generated: ${new Date().toISOString()}`);
  flagLines.push('');

  // Flag 1: Entries with raw scores > 12 on either axis (code block contamination)
  flagLines.push('## High Raw Score Entries (raw > 12)');
  flagLines.push('');
  const highRaw = entries.filter(e => (e.raw_c > 12) || (e.raw_s > 12));
  if (highRaw.length === 0) {
    flagLines.push('None found.');
  } else {
    for (const e of highRaw) {
      flagLines.push(`- Session ${e.session || '?'}: "${truncate(e.prompt_preview || '(empty)', 50)}" — raw_c=${e.raw_c ?? '?'}, raw_s=${e.raw_s ?? '?'} — potential code block contamination`);
    }
  }
  flagLines.push('');

  // Flag 2: Verb is "readonly" but tier is opus/* (potential over-classification)
  flagLines.push('## Readonly Verb with Opus Tier');
  flagLines.push('');
  const readonlyOpus = entries.filter(e => {
    const verb = (e.verb || '').toLowerCase();
    const tier = (e.tier || '').toLowerCase();
    return verb === 'readonly' && tier.startsWith('opus/');
  });
  if (readonlyOpus.length === 0) {
    flagLines.push('None found.');
  } else {
    for (const e of readonlyOpus) {
      flagLines.push(`- Session ${e.session || '?'}: "${truncate(e.prompt_preview || '(empty)', 50)}" — verb=${e.verb}, tier=${e.tier} — potential over-classification`);
    }
  }
  flagLines.push('');

  // Flag 3: Session B tier dropped 3+ levels vs corresponding Session A entry
  flagLines.push('## Session B Regressions (3+ tier drop vs Session A)');
  flagLines.push('');
  const regressions = [];
  for (const [id, { task, entryA, entryB }] of [...taskResults.entries()].sort((a, b) => a[0] - b[0])) {
    if (!entryA || !entryB) continue;
    const idxA = tierIndex(entryA.tier);
    const idxB = tierIndex(entryB.tier);
    if (idxA === null || idxB === null) continue;
    const drop = idxA - idxB;
    if (drop >= 3) {
      regressions.push({ task, entryA, entryB, drop });
    }
  }
  if (regressions.length === 0) {
    flagLines.push('None found.');
  } else {
    for (const r of regressions) {
      flagLines.push(`- **Task ${r.task.id}** "${truncate(r.task.prompt, 40)}": Session A=${r.entryA.tier}, Session B=${r.entryB.tier} (dropped ${r.drop} tiers) — potential system-caused regression`);
    }
  }
  flagLines.push('');

  console.log(flagLines.join('\n'));
}
