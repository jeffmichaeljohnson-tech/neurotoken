import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  TIER_ORDER, MATRIX, THRESHOLDS, bucket,
  COMPLEXITY_SIGNALS, STAKES_SIGNALS,
  scoreDimension, structuralBonus, detectPrimaryVerb,
  contextDampening, computeModifiers, detectUserOverride,
} from '../src/lib/neurotoken-signals.mjs';


// ── 1. bucket() ────────────────────────────────────────────────────

describe('bucket()', () => {
  // THRESHOLDS = [2, 5, 9] → buckets: 0-1→0, 2-4→1, 5-8→2, 9+→3
  const cases = [
    [0, 0],
    [2, 1],
    [3, 1],
    [5, 2],
    [6, 2],
    [9, 3],
    [10, 3],
    [15, 3],
  ];

  for (const [raw, expected] of cases) {
    it(`raw=${raw} should return bucket ${expected}`, () => {
      assert.strictEqual(bucket(raw), expected);
    });
  }
});


// ── 2. MATRIX constants ────────────────────────────────────────────

describe('MATRIX constants', () => {
  it('MATRIX[0][0] = 0 (haiku/low)', () => {
    assert.strictEqual(MATRIX[0][0], 0);
    assert.strictEqual(TIER_ORDER[MATRIX[0][0]], 'haiku/low');
  });

  it('MATRIX[3][3] = 10 (opus/max)', () => {
    assert.strictEqual(MATRIX[3][3], 10);
    assert.strictEqual(TIER_ORDER[MATRIX[3][3]], 'opus/max');
  });

  it('MATRIX[0][3] = 8 (opus/med)', () => {
    assert.strictEqual(MATRIX[0][3], 8);
    assert.strictEqual(TIER_ORDER[MATRIX[0][3]], 'opus/med');
  });

  it('MATRIX[3][0] = 8 (opus/med)', () => {
    assert.strictEqual(MATRIX[3][0], 8);
    assert.strictEqual(TIER_ORDER[MATRIX[3][0]], 'opus/med');
  });

  it('MATRIX[1][1] = 4 (sonnet/med)', () => {
    assert.strictEqual(MATRIX[1][1], 4);
    assert.strictEqual(TIER_ORDER[MATRIX[1][1]], 'sonnet/med');
  });

  it('MATRIX[2][2] = 8 (opus/med)', () => {
    assert.strictEqual(MATRIX[2][2], 8);
    assert.strictEqual(TIER_ORDER[MATRIX[2][2]], 'opus/med');
  });
});


// ── 3. scoreDimension() — Complexity ───────────────────────────────

describe('scoreDimension() — Complexity', () => {
  it('"system architecture design" scores >= 4 (phrase match)', () => {
    const score = scoreDimension('system architecture design', COMPLEXITY_SIGNALS);
    assert.ok(score >= 4, `expected >= 4, got ${score}`);
  });

  it('"fix a typo" scores 0', () => {
    const score = scoreDimension('fix a typo', COMPLEXITY_SIGNALS);
    assert.strictEqual(score, 0);
  });

  // "middleware" is now a weak keyword (weight 1 instead of 2), so total drops from 8 to 7
  it('"refactor the architecture with new middleware and oauth" scores >= 7', () => {
    const score = scoreDimension('refactor the architecture with new middleware and oauth', COMPLEXITY_SIGNALS);
    assert.ok(score >= 7, `expected >= 7, got ${score}`);
  });

  it('"architect a distributed system with graphql" scores >= 8', () => {
    const score = scoreDimension('architect a distributed system with graphql', COMPLEXITY_SIGNALS);
    assert.ok(score >= 8, `expected >= 8, got ${score}`);
  });
});


// ── 4. scoreDimension() — Stakes ───────────────────────────────────

describe('scoreDimension() — Stakes', () => {
  it('"deploy to production database" scores >= 10 (phrase + keywords)', () => {
    const score = scoreDimension('deploy to production database', STAKES_SIGNALS);
    assert.ok(score >= 10, `expected >= 10, got ${score}`);
  });

  it('"rename a variable" scores 0', () => {
    const score = scoreDimension('rename a variable', STAKES_SIGNALS);
    assert.strictEqual(score, 0);
  });

  it('"review the rls policy on user data" scores >= 10', () => {
    const score = scoreDimension('review the rls policy on user data', STAKES_SIGNALS);
    assert.ok(score >= 10, `expected >= 10, got ${score}`);
  });

  it('"update the stripe payment processing" scores >= 7', () => {
    const score = scoreDimension('update the stripe payment processing', STAKES_SIGNALS);
    assert.ok(score >= 7, `expected >= 7, got ${score}`);
  });
});


// ── 5. structuralBonus() ───────────────────────────────────────────

describe('structuralBonus()', () => {
  it('multi-file reference gets +3 bonus', () => {
    const bonus = structuralBonus('update src/auth.ts and lib/utils.ts');
    assert.strictEqual(bonus, 3);
  });

  it('"fix the bug" gets 0 bonus', () => {
    const bonus = structuralBonus('fix the bug');
    assert.strictEqual(bonus, 0);
  });

  it('200-word prompt with complexity keywords gets concept density +2', () => {
    // Build a 200-word prompt that contains oauth, jwt, graphql keywords
    const filler = 'word '.repeat(190).trim();
    const text = `${filler} oauth jwt graphql integration`;
    const words = text.split(/\s+/);
    assert.ok(words.length > 150, `setup check: need >150 words, got ${words.length}`);
    const bonus = structuralBonus(text);
    assert.ok(bonus >= 2, `expected >= 2 (concept density), got ${bonus}`);
  });

  // Multi-step bonus reduced from +2 to +1, and only fires for prompts >30 words
  it('multi-step instructions get +1 bonus (when >30 words)', () => {
    // Build a prompt >30 words that contains first...then pattern
    const filler = 'and process the resulting output data '.repeat(5).trim();
    const text = `first add the type ${filler}, then update the handler, step 3 test it`;
    const words = text.split(/\s+/);
    assert.ok(words.length > 30, `setup check: need >30 words, got ${words.length}`);
    const bonus = structuralBonus(text);
    assert.ok(bonus >= 1, `expected >= 1 (multi-step), got ${bonus}`);
  });
});


// ── 6. detectPrimaryVerb() ─────────────────────────────────────────

describe('detectPrimaryVerb()', () => {
  it('"explain how rls works" detects readonly verb "explain"', () => {
    const result = detectPrimaryVerb('explain how rls works');
    assert.deepStrictEqual(result, { verb: 'explain', type: 'readonly' });
  });

  it('"delete the users table" detects mutating verb "delete"', () => {
    const result = detectPrimaryVerb('delete the users table');
    assert.deepStrictEqual(result, { verb: 'delete', type: 'mutating' });
  });

  it('"what is the best approach" detects readonly verb "what is"', () => {
    const result = detectPrimaryVerb('what is the best approach');
    assert.deepStrictEqual(result, { verb: 'what is', type: 'readonly' });
  });

  it('"fix the auth bug" detects mutating verb "fix"', () => {
    const result = detectPrimaryVerb('fix the auth bug');
    assert.deepStrictEqual(result, { verb: 'fix', type: 'mutating' });
  });

  it('"hello" returns unknown', () => {
    const result = detectPrimaryVerb('hello');
    assert.deepStrictEqual(result, { verb: null, type: 'unknown' });
  });
});


// ── 7. contextDampening() ──────────────────────────────────────────

describe('contextDampening()', () => {
  it('"deploy to test environment" returns -1 (dampened)', () => {
    assert.strictEqual(contextDampening('deploy to test environment'), -1);
  });

  it('"deploy to production" returns 0 (no dampening)', () => {
    assert.strictEqual(contextDampening('deploy to production'), 0);
  });

  it('"delete the old test files" returns -1 (dampened)', () => {
    assert.strictEqual(contextDampening('delete the old test files'), -1);
  });

  it('"delete the production database" returns 0 (no dampening)', () => {
    assert.strictEqual(contextDampening('delete the production database'), 0);
  });

  it('"explain about production best practices" returns -1 (dampened)', () => {
    assert.strictEqual(contextDampening('explain about production best practices'), -1);
  });
});


// ── 8. computeModifiers() ──────────────────────────────────────────

describe('computeModifiers()', () => {
  it('"update the rls policy on users table" includes +auth, shift >= 1', () => {
    const { mods, shift } = computeModifiers('update the rls policy on users table');
    assert.ok(mods.includes('+auth'), `expected +auth in mods, got ${mods}`);
    assert.ok(shift >= 1, `expected shift >= 1, got ${shift}`);
  });

  it('"deploy the migration to production" includes +deploy, shift >= 1', () => {
    const { mods, shift } = computeModifiers('deploy the migration to production');
    assert.ok(mods.includes('+deploy'), `expected +deploy in mods, got ${mods}`);
    assert.ok(shift >= 1, `expected shift >= 1, got ${shift}`);
  });

  it('"update the stripe billing integration" includes +finance, shift >= 1', () => {
    const { mods, shift } = computeModifiers('update the stripe billing integration');
    assert.ok(mods.includes('+finance'), `expected +finance in mods, got ${mods}`);
    assert.ok(shift >= 1, `expected shift >= 1, got ${shift}`);
  });

  it('"changes across alpha-project and beta-project" includes +cross-project', () => {
    process.env.NEUROTOKEN_PROJECTS = 'alpha-project,beta-project,gamma-project';
    try {
      const { mods } = computeModifiers('changes across alpha-project and beta-project');
      assert.ok(mods.includes('+cross-project'), `expected +cross-project in mods, got ${mods}`);
    } finally {
      delete process.env.NEUROTOKEN_PROJECTS;
    }
  });

  it('"run the jest tests" includes -test, shift is negative', () => {
    const { mods, shift } = computeModifiers('run the jest tests');
    assert.ok(mods.includes('-test'), `expected -test in mods, got ${mods}`);
    assert.ok(shift < 0, `expected negative shift, got ${shift}`);
  });

  // "update" is a mutating verb, and -docs requires !isMutating, so -docs does not fire
  it('"update the readme docs" does NOT include -docs (mutating verb suppresses it)', () => {
    const { mods } = computeModifiers('update the readme docs');
    assert.ok(!mods.includes('-docs'), `expected NO -docs when mutating verb present, got ${mods}`);
  });

  it('"read the readme docs" includes -docs (read-only verb allows it)', () => {
    const { mods } = computeModifiers('read the readme docs');
    assert.ok(mods.includes('-docs'), `expected -docs in mods, got ${mods}`);
  });

  it('"format with prettier" includes -format', () => {
    const { mods } = computeModifiers('format with prettier');
    assert.ok(mods.includes('-format'), `expected -format in mods, got ${mods}`);
  });

  it('escalation is capped at +2 even when all escalation triggers fire', () => {
    // Trigger: +auth, +deploy, +finance, +cross-project, +novel
    process.env.NEUROTOKEN_PROJECTS = 'alpha-project,beta-project,gamma-project';
    try {
      const text = 'deploy the new architecture rls policy to production stripe billing alpha-project beta-project from scratch';
      const { shift, mods } = computeModifiers(text);
      // Count how many escalation mods actually triggered
      const escalationMods = mods.filter(m => m.startsWith('+'));
      assert.ok(escalationMods.length >= 3, `expected 3+ escalation mods, got ${escalationMods.length}: ${mods}`);
      // Shift should reflect cap: escalation capped at +2, minus any de-escalation
      const deescalationMods = mods.filter(m => m.startsWith('-'));
      const expectedMax = 2 - Math.min(deescalationMods.length, 1);
      assert.ok(shift <= 2, `expected shift <= 2 (cap), got ${shift}`);
    } finally {
      delete process.env.NEUROTOKEN_PROJECTS;
    }
  });

  it('de-escalation is capped at -1 even when all de-escalation triggers fire', () => {
    // Trigger: -test, -docs, -format (no mutating verb so -docs applies)
    const text = 'check the jest test results in the readme docs and format with prettier';
    const { shift, mods } = computeModifiers(text);
    const deescalationMods = mods.filter(m => m.startsWith('-'));
    assert.ok(deescalationMods.length >= 2, `expected 2+ de-escalation mods, got ${deescalationMods.length}: ${mods}`);
    // De-escalation capped at -1, escalation is 0 here
    assert.ok(shift >= -1, `expected shift >= -1 (cap), got ${shift}`);
  });
});


// ── 9. detectUserOverride() ────────────────────────────────────────

describe('detectUserOverride()', () => {
  it('"think harder about this" returns shift +2', () => {
    const result = detectUserOverride('think harder about this');
    assert.deepStrictEqual(result, { phrase: 'think harder', shift: 2 });
  });

  it('"just tell me the answer" returns shift -1', () => {
    const result = detectUserOverride('just tell me the answer');
    assert.deepStrictEqual(result, { phrase: 'just tell me', shift: -1 });
  });

  it('"regular prompt" returns null', () => {
    const result = detectUserOverride('regular prompt');
    assert.strictEqual(result, null);
  });

  it('"ultrathink through this problem" returns shift +2', () => {
    const result = detectUserOverride('ultrathink through this problem');
    assert.deepStrictEqual(result, { phrase: 'ultrathink', shift: 2 });
  });
});


// ── 10. End-to-End Scoring ─────────────────────────────────────────

/**
 * Run the full scoring pipeline for a given text.
 * Returns { tier, tierName, rawC, rawS, adjustedS, c, s, matrixTier, shift, override }
 */
function fullPipeline(text) {
  const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
  const rawS = scoreDimension(text, STAKES_SIGNALS) + contextDampening(text);

  const verb = detectPrimaryVerb(text);
  let adjustedS = rawS;
  if (verb.type === 'readonly' && adjustedS > 0) {
    adjustedS = Math.max(0, adjustedS - 2);
  }

  const c = bucket(rawC);
  const s = bucket(Math.max(0, adjustedS));
  let tier = MATRIX[c][s];
  const matrixTier = tier;

  const { shift } = computeModifiers(text);
  tier = Math.max(0, Math.min(10, tier + shift));

  const override = detectUserOverride(text);
  if (override) {
    tier = Math.max(0, Math.min(10, tier + override.shift));
  }

  return {
    tier,
    tierName: TIER_ORDER[tier],
    rawC,
    rawS,
    adjustedS,
    c,
    s,
    matrixTier,
    shift,
    override,
    verb,
  };
}

describe('End-to-End Scoring (full pipeline)', () => {
  it('"deploy the rls policy changes to production" should be opus/high or opus/max', () => {
    const { tierName, tier } = fullPipeline('deploy the rls policy changes to production');
    assert.ok(
      tierName === 'opus/high' || tierName === 'opus/max',
      `expected opus/high or opus/max, got ${tierName} (tier ${tier})`
    );
  });

  it('"rename this variable" should be haiku/low or haiku/med', () => {
    const { tierName, tier } = fullPipeline('rename this variable');
    assert.ok(
      tierName === 'haiku/low' || tierName === 'haiku/med',
      `expected haiku/low or haiku/med, got ${tierName} (tier ${tier})`
    );
  });

  it('"explain how rls policies work" should score LOWER than "modify the rls policy"', () => {
    const readOnly = fullPipeline('explain how rls policies work');
    const mutating = fullPipeline('modify the rls policy');
    assert.ok(
      readOnly.tier < mutating.tier,
      `expected readonly (${readOnly.tierName}, tier ${readOnly.tier}) < mutating (${mutating.tierName}, tier ${mutating.tier})`
    );
  });

  it('"deploy to test environment" should score LOWER than "deploy to production"', () => {
    const testEnv = fullPipeline('deploy to test environment');
    const prodEnv = fullPipeline('deploy to production');
    assert.ok(
      testEnv.tier < prodEnv.tier,
      `expected test (${testEnv.tierName}, tier ${testEnv.tier}) < prod (${prodEnv.tierName}, tier ${prodEnv.tier})`
    );
  });

  it('"rename this variable think harder" should be higher than without override', () => {
    const withOverride = fullPipeline('rename this variable think harder');
    const withoutOverride = fullPipeline('rename this variable');
    assert.ok(
      withOverride.tier > withoutOverride.tier,
      `expected override tier (${withOverride.tierName}, ${withOverride.tier}) > base tier (${withoutOverride.tierName}, ${withoutOverride.tier})`
    );
    // "think harder" gives +2 shift, so from haiku/low (0) we expect haiku/high (2)
    assert.ok(
      withOverride.tier === withoutOverride.tier + 2,
      `expected +2 shift from override, got ${withOverride.tier} vs base ${withoutOverride.tier}`
    );
  });

  it('"design a new distributed system architecture with event sourcing and message queue from scratch" should be opus/high or opus/max', () => {
    const { tierName, tier } = fullPipeline(
      'design a new distributed system architecture with event sourcing and message queue from scratch'
    );
    assert.ok(
      tierName === 'opus/high' || tierName === 'opus/max',
      `expected opus/high or opus/max, got ${tierName} (tier ${tier})`
    );
  });

  it('"format with prettier" should be haiku/low', () => {
    const { tierName, tier } = fullPipeline('format with prettier');
    assert.strictEqual(
      tierName, 'haiku/low',
      `expected haiku/low, got ${tierName} (tier ${tier})`
    );
  });
});
