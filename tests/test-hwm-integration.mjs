#!/usr/bin/env node

// Integration tests for the HWM (high-water mark) path in neurotoken-scorer.mjs.
// The HWM logic lives in the scorer (not the signals lib), so these tests spawn
// the scorer as a subprocess with a dedicated TMPDIR and seeded HWM state.
// Run with: node --test tests/test-hwm-integration.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORER = resolve(__dirname, '..', 'src', 'neurotoken-scorer.mjs');

function runScorer(prompt, { hwm, tmpDir }) {
  if (hwm) writeFileSync(join(tmpDir, 'neurotoken-hwm.json'), JSON.stringify(hwm));
  const res = spawnSync('node', [SCORER], {
    input: JSON.stringify({ prompt }),
    env: { ...process.env, NEUROTOKEN_MODE: 'active', TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`scorer exited ${res.status}: ${res.stderr}`);
  if (!res.stdout.trim()) return { annotation: '', tier: null };
  const json = JSON.parse(res.stdout);
  const annotation = json.hookSpecificOutput.additionalContext;
  const match = annotation.match(/→ (\S+)/);
  return { annotation, tier: match ? match[1] : null };
}

describe('HWM integration — baseline behavior', () => {
  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'nt-hwm-')); });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('follow-up "ok do it" inherits HWM floor when no override is present', () => {
    const { tier, annotation } = runScorer('ok do it', {
      tmpDir: tmp,
      hwm: { score: 8, ts: Date.now() },
    });
    assert.notStrictEqual(tier, 'haiku/low',
      `expected HWM-boosted tier, got ${annotation}`);
    assert.ok(annotation.includes('hwm decay'),
      `expected hwm annotation, got ${annotation}`);
  });
});

describe('HWM integration — override bypasses HWM floor', () => {
  it('"quick answer" on trivial prompt bypasses a high HWM', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-hwm-'));
    try {
      const { tier, annotation } = runScorer('quick answer: what time is it', {
        tmpDir: tmp,
        hwm: { score: 6, ts: Date.now() },
      });
      assert.strictEqual(tier, 'haiku/low',
        `override should bypass HWM; got ${annotation}`);
      assert.ok(!annotation.includes('hwm decay'),
        `hwm should have been skipped; got ${annotation}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('"think harder" on trivial prompt uses intrinsic+override, not HWM+override', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-hwm-'));
    try {
      const { tier, annotation } = runScorer('rename a variable, think harder', {
        tmpDir: tmp,
        hwm: { score: 9, ts: Date.now() },
      });
      // Intrinsic haiku/low (0) + "think harder" (+2) = haiku/high (2).
      // If HWM had applied, it would have been opus/high (9) + 2 = opus/max (10).
      assert.strictEqual(tier, 'haiku/high',
        `override should bypass HWM; expected haiku/high, got ${annotation}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('de-escalation override on intrinsically high-stakes prompt still respects intrinsic stakes', () => {
    // "deploy to production, quick answer" — intrinsic score is already high
    // from the stakes keywords. Bypassing HWM does NOT crash this to haiku/low,
    // because the intrinsic tier is already elevated by modifiers.
    const tmp = mkdtempSync(join(tmpdir(), 'nt-hwm-'));
    try {
      const { tier, annotation } = runScorer('deploy to production, quick answer', {
        tmpDir: tmp,
        hwm: { score: 10, ts: Date.now() },
      });
      const TIER_ORDER = ['haiku/low','haiku/med','haiku/high','sonnet/low','sonnet/med',
                          'sonnet/high','sonnet/max','opus/low','opus/med','opus/high','opus/max'];
      const idx = TIER_ORDER.indexOf(tier);
      assert.ok(idx >= TIER_ORDER.indexOf('sonnet/med'),
        `intrinsic prod-deploy stakes should keep tier >= sonnet/med, got ${annotation}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('HWM integration — decay and expiry', () => {
  it('HWM older than 5 minutes is ignored entirely', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nt-hwm-'));
    try {
      const sixMinAgo = Date.now() - 6 * 60_000;
      const { tier, annotation } = runScorer('ok do it', {
        tmpDir: tmp,
        hwm: { score: 10, ts: sixMinAgo },
      });
      assert.strictEqual(tier, 'haiku/low',
        `expired HWM should not affect tier; got ${annotation}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
