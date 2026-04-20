#!/usr/bin/env node

// ── Neurotoken HWM Integration Tests ─────────────────────────────
// Subprocess-based tests that exercise the full scorer pipeline
// with seeded HWM state in an isolated TMPDIR.
// Run with: node --test tests/test-hwm-integration.mjs
// ────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCORER_PATH = join(__dirname, '..', 'src', 'neurotoken-scorer.mjs');

const TIER_ORDER = [
  'haiku/low', 'haiku/med', 'haiku/high',
  'sonnet/low', 'sonnet/med', 'sonnet/high', 'sonnet/max',
  'opus/low', 'opus/med', 'opus/high', 'opus/max',
];

function runScorer(prompt, opts = {}) {
  const isolatedTmp = opts.tmpDir || mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
  const hwmPath = join(isolatedTmp, 'neurotoken-hwm.json');
  if (opts.hwm) writeFileSync(hwmPath, JSON.stringify(opts.hwm));

  const env = {
    ...process.env,
    TMPDIR: isolatedTmp,
    NEUROTOKEN_MODE: opts.mode || 'active',
    NEUROTOKEN_SESSION: opts.session || 'test',
  };

  let stdout = '';
  try {
    stdout = execFileSync('node', [SCORER_PATH], {
      input: JSON.stringify({ prompt }), env, timeout: 5000, encoding: 'utf8',
    });
  } catch (err) {
    if (err.stdout) stdout = err.stdout;
  }

  const logPath = join(isolatedTmp, 'neurotoken-log.jsonl');
  let logEntry = null;
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    logEntry = JSON.parse(lines[lines.length - 1]);
  }
  let hwmAfter = null;
  if (existsSync(hwmPath)) hwmAfter = JSON.parse(readFileSync(hwmPath, 'utf8'));

  let annotation = '';
  if (stdout.trim()) {
    try {
      annotation = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    } catch { /* shadow mode or non-JSON */ }
  }

  return { stdout, annotation, logEntry, hwmAfter, tmpDir: isolatedTmp };
}

function cleanup(tmpDir) {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
}


// ── Baseline ────────────────────────────────────────────────────

describe('HWM baseline behavior', () => {
  it('terse follow-up within 3 min inherits HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 3 * 60_000 };
      const result = runScorer('ok do it', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, true);
      assert.notStrictEqual(result.logEntry.tier, 'haiku/low');
    } finally { cleanup(tmpDir); }
  });

  it('HWM is written after scoring', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const result = runScorer('rename a variable', { tmpDir });
      assert.ok(result.hwmAfter !== null);
      assert.strictEqual(typeof result.hwmAfter.score, 'number');
      assert.strictEqual(typeof result.hwmAfter.ts, 'number');
    } finally { cleanup(tmpDir); }
  });
});


// ── Session-start pollution fix ─────────────────────────────────

describe('HWM session-start pollution — fresh task prompts must not inherit stale HWM', () => {
  it('HWM 15 min ago + fresh task prompt → no HWM; tier matches intrinsic', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 15 * 60_000 };
      const result = runScorer('launch the app on the simulator', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, false);
      assert.strictEqual(result.logEntry.tier, 'haiku/low');
    } finally { cleanup(tmpDir); }
  });

  it('HWM 3 min ago + terse "ok do it" → HWM applies', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 3 * 60_000 };
      const result = runScorer('ok do it', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, true);
      assert.notStrictEqual(result.logEntry.tier, 'haiku/low');
    } finally { cleanup(tmpDir); }
  });

  it('HWM 15 min ago + terse "ok do it" → absolute expiry kills HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 15 * 60_000 };
      const result = runScorer('ok do it', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, false);
    } finally { cleanup(tmpDir); }
  });

  it('HWM 3 min ago + fresh "Launch PrayerMap..." → no HWM (exact bug scenario)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 3 * 60_000 };
      const result = runScorer(
        'Launch PrayerMap on both the iOS simulator and the watchOS simulator, please.',
        { tmpDir, hwm }
      );
      assert.strictEqual(result.logEntry.hwm_applied, false);
      const tierIdx = TIER_ORDER.indexOf(result.logEntry.tier);
      assert.ok(tierIdx <= 2, `fresh launch prompt should be haiku-tier, got ${result.logEntry.tier}`);
    } finally { cleanup(tmpDir); }
  });

  it('HWM 4 min ago + fresh task prompt → no HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 8, ts: Date.now() - 4 * 60_000 };
      const result = runScorer('check the build logs for errors', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, false);
    } finally { cleanup(tmpDir); }
  });

  it('HWM 7 min ago + fresh task prompt → no HWM (past 5-min decay)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 10, ts: Date.now() - 7 * 60_000 };
      const result = runScorer('run the test suite', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, false);
    } finally { cleanup(tmpDir); }
  });

  it('terse "yes" within 2 min inherits HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 8, ts: Date.now() - 2 * 60_000 };
      const result = runScorer('yes', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, true);
    } finally { cleanup(tmpDir); }
  });

  it('terse "proceed" within 4 min inherits HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const hwm = { score: 9, ts: Date.now() - 4 * 60_000 };
      const result = runScorer('proceed', { tmpDir, hwm });
      assert.strictEqual(result.logEntry.hwm_applied, true);
    } finally { cleanup(tmpDir); }
  });
});


// ── Override bypasses HWM ──────────────────────────────────────

describe('HWM integration — user override bypasses HWM floor', () => {
  it('"quick answer" on trivial prompt bypasses a high HWM', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const result = runScorer('quick answer: what time is it', {
        tmpDir, hwm: { score: 6, ts: Date.now() },
      });
      assert.strictEqual(result.logEntry.tier, 'haiku/low');
      assert.strictEqual(result.logEntry.hwm_applied, false);
    } finally { cleanup(tmpDir); }
  });

  it('"think harder" on trivial prompt uses intrinsic+override, not HWM+override', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const result = runScorer('rename a variable, think harder', {
        tmpDir, hwm: { score: 9, ts: Date.now() },
      });
      // Intrinsic haiku/low (0) + "think harder" (+2) = haiku/high (2).
      // With HWM it would have been opus/high (9) + 2 = opus/max (10).
      assert.strictEqual(result.logEntry.tier, 'haiku/high');
    } finally { cleanup(tmpDir); }
  });

  it('de-escalation override on intrinsically high-stakes prompt preserves stakes floor', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'neurotoken-test-'));
    try {
      const result = runScorer('deploy to production, quick answer', {
        tmpDir, hwm: { score: 10, ts: Date.now() },
      });
      const idx = TIER_ORDER.indexOf(result.logEntry.tier);
      assert.ok(idx >= TIER_ORDER.indexOf('sonnet/med'),
        `prod-deploy stakes should keep tier >= sonnet/med, got ${result.logEntry.tier}`);
    } finally { cleanup(tmpDir); }
  });
});
