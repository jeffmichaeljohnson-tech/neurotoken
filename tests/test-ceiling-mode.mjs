#!/usr/bin/env node

// ── Neurotoken Ceiling-Rule Mode Tests ───────────────────────────
// Validates NEUROTOKEN_MODE=active-ceiling behavior: permits downgrade
// for low-tier work, blocks downgrade when safety modifiers or S=3 fire.
// Run with: node --test tests/test-ceiling-mode.mjs
// ────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORER_PATH = join(__dirname, '..', 'src', 'neurotoken-scorer.mjs');

function runScorer(prompt, opts = {}) {
  const tmp = opts.tmpDir || mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
  const env = {
    ...process.env,
    TMPDIR: tmp,
    NEUROTOKEN_MODE: opts.mode || 'active-ceiling',
    NEUROTOKEN_SESSION: 'test',
  };
  if (opts.ceiling) env.NEUROTOKEN_CEILING = opts.ceiling;

  let stdout = '';
  try {
    stdout = execFileSync('node', [SCORER_PATH], {
      input: JSON.stringify({ prompt }), env, timeout: 5000, encoding: 'utf8',
    });
  } catch (err) {
    if (err.stdout) stdout = err.stdout;
  }

  let annotation = '';
  if (stdout.trim()) {
    try { annotation = JSON.parse(stdout).hookSpecificOutput.additionalContext; } catch {}
  }

  const logPath = join(tmp, 'neurotoken-log.jsonl');
  let logEntry = null;
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    logEntry = JSON.parse(lines[lines.length - 1]);
  }

  return { annotation, logEntry, tmpDir: tmp };
}

function cleanup(tmpDir) {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}


describe('ceiling mode — permits downgrade on safe low-tier prompts', () => {
  it('trivial prompt gets downgrade OK suffix', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('rename this variable', { tmpDir: tmp });
      assert.match(r.annotation, /haiku\/low/);
      assert.match(r.annotation, /downgrade OK from opus\/max/);
      assert.strictEqual(r.logEntry.downgrade_ok, true);
      assert.strictEqual(r.logEntry.ceiling, 'opus/max');
    } finally { cleanup(tmp); }
  });

  it('conversational prompt gets downgrade OK', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('what does rls mean?', { tmpDir: tmp });
      assert.match(r.annotation, /downgrade OK/);
      assert.strictEqual(r.logEntry.downgrade_ok, true);
    } finally { cleanup(tmp); }
  });

  it('custom ceiling via NEUROTOKEN_CEILING env is honored', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('rename this variable', { tmpDir: tmp, ceiling: 'sonnet/max' });
      assert.match(r.annotation, /downgrade OK from sonnet\/max/);
      assert.strictEqual(r.logEntry.ceiling, 'sonnet/max');
    } finally { cleanup(tmp); }
  });
});


describe('ceiling mode — safety guards block downgrade', () => {
  it('+auth blocks downgrade', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('update the auth middleware', { tmpDir: tmp });
      assert.ok(r.logEntry.mods.includes('+auth'),
        `expected +auth, got ${JSON.stringify(r.logEntry.mods)}`);
      assert.doesNotMatch(r.annotation, /downgrade OK/,
        `downgrade should be blocked; annotation: ${r.annotation}`);
      assert.strictEqual(r.logEntry.downgrade_ok, false);
    } finally { cleanup(tmp); }
  });

  it('+deploy blocks downgrade', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('push this to production', { tmpDir: tmp });
      assert.ok(r.logEntry.mods.includes('+deploy'));
      assert.doesNotMatch(r.annotation, /downgrade OK/);
      assert.strictEqual(r.logEntry.downgrade_ok, false);
    } finally { cleanup(tmp); }
  });

  it('+finance blocks downgrade', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('update the stripe webhook', { tmpDir: tmp });
      assert.ok(r.logEntry.mods.includes('+finance'));
      assert.doesNotMatch(r.annotation, /downgrade OK/);
      assert.strictEqual(r.logEntry.downgrade_ok, false);
    } finally { cleanup(tmp); }
  });

  it('S=3 critical stakes blocks downgrade even without modifier', () => {
    // "deploy rls policy to production" scores S=3 raw=12
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('deploy rls policy to production', { tmpDir: tmp });
      assert.strictEqual(r.logEntry.s, 3, `expected S=3, got S=${r.logEntry.s}`);
      assert.doesNotMatch(r.annotation, /downgrade OK/);
      assert.strictEqual(r.logEntry.downgrade_ok, false);
    } finally { cleanup(tmp); }
  });

  it('tier at-or-above ceiling does not emit downgrade OK', () => {
    // Set a low ceiling and use a mid-tier prompt that meets or exceeds it
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('rename this variable', { tmpDir: tmp, ceiling: 'haiku/low' });
      assert.match(r.annotation, /haiku\/low/);
      assert.doesNotMatch(r.annotation, /downgrade OK/,
        `at ceiling: no downgrade should be emitted; got ${r.annotation}`);
    } finally { cleanup(tmp); }
  });
});


describe('ceiling mode — does not affect other modes', () => {
  it('active mode never emits downgrade suffix', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('rename this variable', { tmpDir: tmp, mode: 'active' });
      assert.doesNotMatch(r.annotation, /downgrade OK/);
      assert.strictEqual(r.logEntry.downgrade_ok, false);
    } finally { cleanup(tmp); }
  });

  it('shadow mode never emits stdout at all', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-ceiling-'));
    try {
      const r = runScorer('rename this variable', { tmpDir: tmp, mode: 'shadow' });
      assert.strictEqual(r.annotation, '');
      assert.strictEqual(r.logEntry.mode, 'shadow');
    } finally { cleanup(tmp); }
  });
});
