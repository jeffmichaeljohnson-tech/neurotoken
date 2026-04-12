#!/usr/bin/env node

// ── Neurotoken Edge Case Test Suite ────────────────────────────────
// Targets known failure modes: false escalation, false de-escalation,
// context disambiguation, modifier edge cases, user overrides,
// normalization, boundary conditions, and matrix properties.
// Run with: node --test tests/test-edge-cases.mjs
// ────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TIER_ORDER, MATRIX, bucket,
  COMPLEXITY_SIGNALS, STAKES_SIGNALS,
  scoreDimension, structuralBonus, detectPrimaryVerb,
  contextDampening, computeModifiers, detectUserOverride,
} from '../src/lib/neurotoken-signals.mjs';
import { normalize } from '../src/lib/normalize.mjs';


// ── Helpers ────────────────────────────────────────────────────────

function tierIndex(name) {
  return TIER_ORDER.indexOf(name);
}

function fullScore(rawPrompt) {
  const text = normalize(rawPrompt);
  let rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
  let rawS = scoreDimension(text, STAKES_SIGNALS);

  // Context dampening
  rawS += contextDampening(text);
  rawS = Math.max(0, rawS);

  // Verb adjustment
  const verb = detectPrimaryVerb(text);
  if (verb.type === 'readonly' && rawS > 0) rawS = Math.max(0, rawS - 2);

  const c = bucket(rawC);
  const s = bucket(Math.max(0, rawS));
  let tierIdx = MATRIX[c][s];

  // Modifiers
  const { shift, mods } = computeModifiers(text);
  tierIdx = Math.max(0, Math.min(10, tierIdx + shift));

  // User overrides
  const override = detectUserOverride(text);
  if (override) tierIdx = Math.max(0, Math.min(10, tierIdx + override.shift));

  return { tier: TIER_ORDER[tierIdx], tierIndex: tierIdx, c, s, rawC, rawS, mods, verb, override };
}


// ── 1. False Escalation ────────────────────────────────────────────
// Prompts containing stakes keywords in non-actionable contexts.
// They should all score BELOW opus/med (tierIndex < 8).

describe('False Escalation — prompts that look high-stakes but are read-only', () => {
  const opusMedIdx = tierIndex('opus/med');

  it('RLS keyword with read-only verb should not escalate to opus', () => {
    const result = fullScore('Can you explain how RLS policies work in Supabase?');
    assert.ok(
      result.tierIndex < opusMedIdx,
      `Expected below opus/med (${opusMedIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS} verb=${result.verb.type}`
    );
  });

  it('"production" + "deployment" in educational context should not escalate', () => {
    const result = fullScore(
      "I'm reading about production deployment best practices, can you summarize?"
    );
    assert.ok(
      result.tierIndex < opusMedIdx,
      `Expected below opus/med (${opusMedIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS} verb=${result.verb.type}`
    );
  });

  it('Destructive SQL keyword in educational context should stay low', () => {
    const result = fullScore('What does DROP TABLE do in SQL?');
    assert.ok(
      result.tierIndex < opusMedIdx,
      `Expected below opus/med (${opusMedIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS} verb=${result.verb.type}`
    );
  });

  it('"migration" + "test" dampened together should stay moderate', () => {
    const result = fullScore('Show me an example migration that adds a column to a test table');
    assert.ok(
      result.tierIndex < opusMedIdx,
      `Expected below opus/med (${opusMedIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS} verb=${result.verb.type}`
    );
  });

  it('Blog post about security should cap at sonnet/med max', () => {
    const result = fullScore('Write a blog post about why database security matters');
    const sonnetMedIdx = tierIndex('sonnet/med');
    assert.ok(
      result.tierIndex <= sonnetMedIdx,
      `Expected at most sonnet/med (${sonnetMedIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS} verb=${result.verb.type}`
    );
  });
});


// ── 2. False De-escalation ─────────────────────────────────────────
// Short prompts with critical intent. Should score above haiku/low.
//
// FIXED GAPS (v0.2.0):
// - "auth" and "main" added to STAKES_SIGNALS (now as weakKeywords at weight 1)
// - THRESHOLDS lowered from [3,6,10] to [2,5,9]
//
// UPDATED (v0.3.0 — weak keyword split):
// - "auth" and "main" moved to weakKeywords (weight 1 instead of 2)
// - Single weak keyword hit (rawS=1) stays in bucket 0
// - Modifier still fires, pushing tier up by 1
// - "Fix the auth bug": rawS=1 → bucket 0 → MATRIX[0][0]=0, +auth mod → 1 (haiku/med)
// - "Update the payment handler": rawS=2 (payment is strong) → bucket 1 → MATRIX[0][1]=1, +finance mod → 2
// - "Push this to main": rawS=1 → bucket 0 → MATRIX[0][0]=0, +deploy mod → 1 (haiku/med)
//
// REMAINING GAP (documented for future signal tuning):
// - "Delete the old user data": "user data" phrase (5pts) dampened by
//   "old" near "delete" → rawS=4 → bucket 1 → MATRIX[0][1]=1 → haiku/med.
//   IDEAL: at least sonnet/high. FIX: "user data" should resist dampening.

describe('False De-escalation — short prompts with critical intent', () => {
  const sonnetHighIdx = tierIndex('sonnet/high');

  // --- Currently working correctly ---

  it('"Change the RLS policy" — short, direct, critical', () => {
    const result = fullScore('Change the RLS policy');
    assert.ok(
      result.tierIndex >= sonnetHighIdx,
      `Expected at least sonnet/high (${sonnetHighIdx}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS}`
    );
  });

  // --- Fixed gaps: auth, payment, main now score higher than haiku/med ---

  // "auth" moved to weakKeywords (weight 1), so rawS=1 < threshold 2 → bucket 0
  // MATRIX[0][0]=0, +auth modifier fires → tierIdx=1 (haiku/med)
  it('"Fix the auth bug" — auth weak keyword + modifier gets to haiku/med', () => {
    const result = fullScore('Fix the auth bug');
    assert.ok(
      result.tierIndex >= 1,
      `Should score at least haiku/med (1), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS}`
    );
    assert.ok(result.mods.includes('+auth'), 'Should trigger +auth modifier');
    assert.strictEqual(result.verb.type, 'mutating', 'Should detect mutating verb');
  });

  it('"Update the payment handler" — payment keyword + modifier elevates above haiku/med', () => {
    const result = fullScore('Update the payment handler');
    // "payment" in STAKES_SIGNALS.keywords → rawS=2 → bucket 1 → MATRIX[0][1]=1
    // +finance modifier fires (payment + mutating verb) → tierIdx=2 (haiku/high)
    assert.ok(
      result.tierIndex > 1,
      `Should score above haiku/med (1), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS}`
    );
    assert.ok(result.mods.includes('+finance'), 'Should trigger +finance modifier');
  });

  it('[KNOWN GAP] "Delete the old user data" — dampening reduces "user data" phrase, scores haiku/med', () => {
    const result = fullScore('Delete the old user data');
    // "user data" phrase (5pts), dampened by "old" near "delete" → rawS=4
    // bucket(4)=1 → MATRIX[0][1]=1 → haiku/med
    // Ideal: at least sonnet/high (5) — "user data" should resist dampening
    assert.strictEqual(result.tierIndex, 1, `Current behavior: haiku/med (1), got ${result.tier} (${result.tierIndex})`);
    assert.strictEqual(result.verb.type, 'mutating', 'Should detect mutating verb');
  });

  // "main" moved to weakKeywords (weight 1), so rawS=1 < threshold 2 → bucket 0
  // MATRIX[0][0]=0, +deploy modifier fires → tierIdx=1 (haiku/med)
  it('"Push this to main" — main weak keyword + deploy modifier gets to haiku/med', () => {
    const result = fullScore('Push this to main');
    assert.ok(
      result.tierIndex >= 1,
      `Should score at least haiku/med (1), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} rawS=${result.rawS}`
    );
    assert.ok(result.mods.includes('+deploy'), 'Should trigger +deploy modifier');
  });
});


// ── 3. Context Disambiguation ──────────────────────────────────────
// Pairs of prompts: the higher one should score strictly above the lower.

describe('Context Disambiguation — paired prompts with different risk levels', () => {
  it('"deploy to production" should score higher than "deploy to test environment"', () => {
    const high = fullScore('deploy to production');
    const low = fullScore('deploy to test environment');
    assert.ok(
      high.tierIndex > low.tierIndex,
      `Expected production (${high.tier}=${high.tierIndex}) > test (${low.tier}=${low.tierIndex})`
    );
  });

  it('"delete the production database" > "delete the old test files"', () => {
    const high = fullScore('delete the production database');
    const low = fullScore('delete the old test files');
    assert.ok(
      high.tierIndex > low.tierIndex,
      `Expected prod delete (${high.tier}=${high.tierIndex}) > test delete (${low.tier}=${low.tierIndex})`
    );
  });

  it('"modify the RLS policy" > "explain how RLS policies work"', () => {
    const high = fullScore('modify the RLS policy');
    const low = fullScore('explain how RLS policies work');
    assert.ok(
      high.tierIndex > low.tierIndex,
      `Expected modify (${high.tier}=${high.tierIndex}) > explain (${low.tier}=${low.tierIndex})`
    );
  });

  it('"update the stripe billing" > "describe the stripe billing flow"', () => {
    const high = fullScore('update the stripe billing');
    const low = fullScore('describe the stripe billing flow');
    assert.ok(
      high.tierIndex > low.tierIndex,
      `Expected update (${high.tier}=${high.tierIndex}) > describe (${low.tier}=${low.tierIndex})`
    );
  });

  it('"push to main" > "push to feature branch"', () => {
    const high = fullScore('push to main');
    const low = fullScore('push to feature branch');
    assert.ok(
      high.tierIndex > low.tierIndex,
      `Expected main (${high.tier}=${high.tierIndex}) > feature (${low.tier}=${low.tierIndex})`
    );
  });
});


// ── 4. Modifier Edge Cases ─────────────────────────────────────────

describe('Modifier Edge Cases — cap behavior and multi-trigger interactions', () => {
  it('stacked escalation triggers should cap at +2', () => {
    const result = fullScore(
      'update the rls policy and deploy to production with stripe billing'
    );
    assert.ok(
      result.mods.includes('+auth'),
      `Expected +auth in mods, got: [${result.mods}]`
    );
    assert.ok(
      result.mods.includes('+deploy'),
      `Expected +deploy in mods, got: [${result.mods}]`
    );
    assert.ok(
      result.mods.includes('+finance'),
      `Expected +finance in mods, got: [${result.mods}]`
    );
    const { shift } = computeModifiers(
      normalize('update the rls policy and deploy to production with stripe billing')
    );
    assert.strictEqual(shift, 2, `Escalation should cap at +2, got ${shift}`);
  });

  it('stacked de-escalation triggers should cap at -1', () => {
    const text = normalize('run the jest tests for the docs');
    const { shift, mods } = computeModifiers(text);
    assert.ok(mods.includes('-test'), `Expected -test, got: [${mods}]`);
    assert.ok(mods.includes('-docs'), `Expected -docs, got: [${mods}]`);
    assert.strictEqual(shift, -1, `De-escalation should cap at -1, got ${shift}`);
  });

  it('"test the production deploy" — -test suppressed by prod, +deploy suppressed by dampening', () => {
    const text = normalize('test the production deploy');
    const { mods, shift } = computeModifiers(text);
    // "test" near "production" triggers contextDampening → isDampened=true
    // So +deploy does NOT fire (requires !isDampened)
    // -test does NOT fire (requires !hasProd, but "production" is present)
    // Result: no modifiers at all
    assert.deepStrictEqual(mods, [], `Expected no mods (both suppressed), got: [${mods}]`);
    assert.strictEqual(shift, 0, `Expected shift=0, got ${shift}`);
  });

  it('"new architecture from scratch" should trigger +novel', () => {
    const text = normalize('new architecture from scratch for the greenfield project');
    const { shift, mods } = computeModifiers(text);
    assert.ok(mods.includes('+novel'), `Expected +novel in mods, got: [${mods}]`);
    assert.ok(shift >= 1, `Expected shift >= 1, got ${shift}`);
  });

  it('multi-project names should trigger +cross-project', () => {
    process.env.NEUROTOKEN_PROJECTS = 'alpha-project,beta-project,gamma-project';
    try {
      const text = normalize('changes across alpha-project and beta-project and gamma-project');
      const { shift, mods } = computeModifiers(text);
      assert.ok(
        mods.includes('+cross-project'),
        `Expected +cross-project in mods, got: [${mods}]`
      );
      assert.ok(shift >= 1, `Expected shift >= 1, got ${shift}`);
    } finally {
      delete process.env.NEUROTOKEN_PROJECTS;
    }
  });
});


// ── 5. User Override Edge Cases ────────────────────────────────────

describe('User Override Edge Cases — escalation, de-escalation, and conflicts', () => {
  it('"think harder" should escalate a trivial prompt by +2', () => {
    const base = fullScore('rename a variable');
    const boosted = fullScore('rename a variable, think harder');
    assert.ok(
      boosted.override !== null,
      'Expected override to be detected'
    );
    assert.strictEqual(boosted.override.shift, 2);
    assert.ok(
      boosted.tierIndex >= base.tierIndex + 2 || boosted.tierIndex === 10,
      `Expected boosted (${boosted.tierIndex}) >= base+2 (${base.tierIndex + 2})`
    );
  });

  it('"quick answer" de-escalation should not reduce below base tier for high-stakes prompt', () => {
    const result = fullScore('deploy to production, quick answer');
    // Even with -1 override, the prompt should still reflect production deploy stakes
    // It should remain at a reasonable tier, not crash to haiku/low
    assert.ok(
      result.tierIndex >= tierIndex('sonnet/med'),
      `Expected at least sonnet/med after de-escalation, got ${result.tier} (${result.tierIndex})`
    );
  });

  it('"think harder think harder" — duplicate should only count as +2 (first match wins)', () => {
    const result = fullScore('think harder think harder');
    assert.ok(result.override !== null, 'Expected override to be detected');
    assert.strictEqual(
      result.override.shift, 2,
      `Expected +2 from first match, not additive. Got shift=${result.override.shift}`
    );
  });

  it('"think harder and think less" — first match wins (+2)', () => {
    const result = fullScore('think harder and think less');
    assert.ok(result.override !== null, 'Expected override to be detected');
    assert.strictEqual(
      result.override.shift, 2,
      `Expected +2 (think harder matched first), got shift=${result.override.shift}`
    );
  });

  it('empty string should return null for override', () => {
    const override = detectUserOverride('');
    assert.strictEqual(override, null, 'Expected null for empty string');
  });
});


// ── 6. Normalize Edge Cases ────────────────────────────────────────

describe('Normalize Edge Cases — casing, contractions, whitespace', () => {
  it('UPPERCASE should score the same as lowercase', () => {
    const upper = fullScore('DEPLOY TO PRODUCTION');
    const lower = fullScore('deploy to production');
    assert.strictEqual(
      upper.tierIndex, lower.tierIndex,
      `UPPER (${upper.tier}=${upper.tierIndex}) !== lower (${lower.tier}=${lower.tierIndex})`
    );
  });

  it("contraction 'don't' should expand and still detect deploy + production", () => {
    const result = fullScore("don't deploy to production");
    const text = normalize("don't deploy to production");
    assert.ok(
      text.includes('do not'),
      `Contraction should expand: "${text}"`
    );
    assert.ok(
      text.includes('deploy'),
      `Should still contain "deploy": "${text}"`
    );
    assert.ok(
      text.includes('production'),
      `Should still contain "production": "${text}"`
    );
  });

  it('newlines should be collapsed into spaces', () => {
    const withNewlines = fullScore('deploy\n\nto\n\nproduction');
    const normal = fullScore('deploy to production');
    assert.strictEqual(
      withNewlines.tierIndex, normal.tierIndex,
      `Newline version (${withNewlines.tier}) !== normal (${normal.tier})`
    );
  });

  it('multiple spaces should be collapsed', () => {
    const withSpaces = fullScore('deploy   to   production');
    const normal = fullScore('deploy to production');
    assert.strictEqual(
      withSpaces.tierIndex, normal.tierIndex,
      `Multi-space version (${withSpaces.tier}) !== normal (${normal.tier})`
    );
  });
});


// ── 7. Boundary Conditions ─────────────────────────────────────────

describe('Boundary Conditions — empty, long, minimal, and special inputs', () => {
  it('empty string should not crash and return haiku/low', () => {
    const result = fullScore('');
    assert.ok(result.tier !== undefined, 'Should return a tier');
    assert.strictEqual(
      result.tier, 'haiku/low',
      `Empty prompt should be haiku/low, got ${result.tier}`
    );
  });

  it('very long prompt (1000+ words) should complete without error', () => {
    const longPrompt = 'please fix ' + 'the code that handles user input validation '.repeat(30);
    assert.ok(longPrompt.split(/\s+/).length > 200, 'Test setup: prompt should be 200+ words');
    const result = fullScore(longPrompt);
    assert.ok(result.tier !== undefined, 'Should return a valid tier');
    assert.ok(
      TIER_ORDER.includes(result.tier),
      `Tier "${result.tier}" should be in TIER_ORDER`
    );
  });

  it('prompt with only code should score low', () => {
    const result = fullScore('```const x = 1```');
    assert.ok(
      result.tierIndex <= tierIndex('sonnet/low'),
      `Code-only prompt should be low, got ${result.tier} (${result.tierIndex})`
    );
  });

  it('single word "deploy" should pick up stakes signal', () => {
    const result = fullScore('deploy');
    assert.ok(
      result.rawS > 0 || result.tierIndex > 0,
      `"deploy" should trigger at least some stakes signal. rawS=${result.rawS}`
    );
  });

  it('special characters should not crash the scorer', () => {
    const result = fullScore('fix the bug!!! @#$%');
    assert.ok(result.tier !== undefined, 'Should return a tier');
    assert.ok(
      TIER_ORDER.includes(result.tier),
      `Tier "${result.tier}" should be in TIER_ORDER`
    );
  });
});


// ── 8. Matrix Symmetry Verification ────────────────────────────────

describe('Matrix Properties — dimensions, ranges, and monotonicity', () => {
  it('MATRIX should have exactly 4 rows', () => {
    assert.strictEqual(MATRIX.length, 4, `Expected 4 rows, got ${MATRIX.length}`);
  });

  it('each MATRIX row should have exactly 4 columns', () => {
    for (let i = 0; i < MATRIX.length; i++) {
      assert.strictEqual(
        MATRIX[i].length, 4,
        `Row ${i} has ${MATRIX[i].length} columns, expected 4`
      );
    }
  });

  it('all MATRIX values should be valid TIER_ORDER indices (0-10)', () => {
    for (let c = 0; c < 4; c++) {
      for (let s = 0; s < 4; s++) {
        const val = MATRIX[c][s];
        assert.ok(
          val >= 0 && val <= 10,
          `MATRIX[${c}][${s}] = ${val} is out of range 0-10`
        );
      }
    }
  });

  it('C=3 row should always map to opus (tier index >= 8)', () => {
    for (let s = 0; s < 4; s++) {
      const val = MATRIX[3][s];
      assert.ok(
        val >= 8,
        `MATRIX[3][${s}] = ${val} (${TIER_ORDER[val]}) should be >= 8 (opus/med)`
      );
    }
  });

  it('S=3 column should never map below opus/med (tier index >= 8)', () => {
    for (let c = 0; c < 4; c++) {
      const val = MATRIX[c][3];
      assert.ok(
        val >= 8,
        `MATRIX[${c}][3] = ${val} (${TIER_ORDER[val]}) should be >= 8 (opus/med)`
      );
    }
  });

  it('diagonal should increase monotonically', () => {
    for (let i = 0; i < 3; i++) {
      assert.ok(
        MATRIX[i][i] < MATRIX[i + 1][i + 1],
        `MATRIX[${i}][${i}] (${MATRIX[i][i]}) should be < MATRIX[${i + 1}][${i + 1}] (${MATRIX[i + 1][i + 1]})`
      );
    }
  });
});


// ── 9. Code Block Stripping ───────────────────────────────────────

describe('Code Block Stripping', () => {
  it('fenced code blocks are stripped before scoring', () => {
    const text = normalize('explain this:\n```\n// deploy to production auth\nconst x = 1;\n```');
    const rawS = scoreDimension(text, STAKES_SIGNALS);
    // Keywords inside code fences should not inflate stakes
    assert.ok(rawS < 4, `Code block keywords should be stripped, got rawS=${rawS}`);
  });

  it('inline code is stripped before scoring', () => {
    const text = normalize('what does `production.deploy(auth)` do?');
    const rawS = scoreDimension(text, STAKES_SIGNALS);
    assert.ok(rawS < 4, `Inline code keywords should be stripped, got rawS=${rawS}`);
  });

  it('non-code keywords still score normally', () => {
    const text = normalize('deploy to production with auth');
    const rawS = scoreDimension(text, STAKES_SIGNALS);
    assert.ok(rawS >= 4, `Non-code keywords should still score, got rawS=${rawS}`);
  });
});


// ── 10. Verb Detection Fixes ──────────────────────────────────────

describe('Verb Detection Fixes', () => {
  it('read does not match inside already', () => {
    const result = detectPrimaryVerb(normalize('deploy the already-tested migration'));
    assert.strictEqual(result.type, 'mutating', 'should detect deploy, not read inside already');
  });

  it('view does not match inside review', () => {
    const result = detectPrimaryVerb(normalize('review the code changes'));
    assert.strictEqual(result.verb, 'review');
    assert.strictEqual(result.type, 'readonly');
  });

  it('mutating verb at start wins over readonly later', () => {
    const result = detectPrimaryVerb(normalize('update the auth flow and explain the changes'));
    assert.strictEqual(result.type, 'mutating', 'update should win over explain');
  });

  it('readonly verb at start wins when no mutation', () => {
    const result = detectPrimaryVerb(normalize('explain how deployment works'));
    assert.strictEqual(result.type, 'readonly');
  });

  it('check does not match inside checkbox', () => {
    const result = detectPrimaryVerb(normalize('add a checkbox to the form'));
    assert.notStrictEqual(result.verb, 'check');
  });

  it('show does not match inside showcase', () => {
    const result = detectPrimaryVerb(normalize('build a showcase page'));
    assert.notStrictEqual(result.verb, 'show');
  });
});


// ── 11. Read-only De-escalation Modifier ──────────────────────────

describe('Read-only De-escalation Modifier', () => {
  it('readonly verb with no mutation triggers -readonly', () => {
    const result = computeModifiers(normalize('explain the database caching policy'));
    assert.ok(result.mods.includes('-readonly'), `should include -readonly, got ${result.mods}`);
  });

  it('readonly verb WITH mutating verb does not trigger -readonly', () => {
    const result = computeModifiers(normalize('explain and then update the auth flow'));
    assert.ok(!result.mods.includes('-readonly'), 'should not include -readonly when mutating verb present');
  });
});


// ── 12. Weak Keyword Weights ──────────────────────────────────────

describe('Weak Keyword Weights', () => {
  it('weak stakes keywords score less than strong ones', () => {
    const weakText = normalize('check the database env');  // both weak: database, env
    const strongText = normalize('check the security vulnerability');  // both strong
    const weakScore = scoreDimension(weakText, STAKES_SIGNALS);
    const strongScore = scoreDimension(strongText, STAKES_SIGNALS);
    assert.ok(strongScore > weakScore, `strong (${strongScore}) should exceed weak (${weakScore})`);
  });
});
