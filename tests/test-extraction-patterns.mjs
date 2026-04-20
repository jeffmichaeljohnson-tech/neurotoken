#!/usr/bin/env node

// ── Imperative Extraction Pattern Tests ──────────────────────────
// Covers terse prompts that imply architectural work (extract, split,
// separate, make independent, etc.) and the +deploy false positive
// guard that prevents project-organization contexts from escalating.
// Run with: node --test tests/test-extraction-patterns.mjs
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

  rawS += contextDampening(text);
  rawS = Math.max(0, rawS);

  const verb = detectPrimaryVerb(text);
  if (verb.type === 'readonly' && rawS > 0) rawS = Math.max(0, rawS - 2);

  const c = bucket(rawC);
  const s = bucket(Math.max(0, rawS));
  let tierIdx = MATRIX[c][s];

  const { shift, mods } = computeModifiers(text);
  tierIdx = Math.max(0, Math.min(10, tierIdx + shift));

  const override = detectUserOverride(text);
  if (override) tierIdx = Math.max(0, Math.min(10, tierIdx + override.shift));

  return { tier: TIER_ORDER[tierIdx], tierIndex: tierIdx, c, s, rawC, rawS, mods, verb, override };
}


// ── Imperative Extraction Patterns ───────────────────────────────

describe('Imperative Extraction Patterns — architectural work in terse prompts', () => {

  // Each extraction pattern produces raw_c >= 2 (enough for C=1 bucket)

  it('"make the adaptive UI skill a completely independent project" gets raw_c >= 2', () => {
    const text = normalize('make the adaptive UI skill a completely independent project');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"extract the auth module into its own package" gets raw_c >= 2', () => {
    const text = normalize('extract the auth module into its own package');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"move the service to its own repo" gets raw_c >= 2', () => {
    const text = normalize('move the service to its own repo');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"migrate the database layer to a separate service" gets raw_c >= 2', () => {
    const text = normalize('migrate the database layer to a separate service');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"refactor the monolith into microservices" gets raw_c >= 2', () => {
    const text = normalize('refactor the monolith into microservices');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"split the app into two repos" gets raw_c >= 2', () => {
    const text = normalize('split the app into two repos');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"separate the frontend from the backend" gets raw_c >= 2', () => {
    const text = normalize('separate the frontend from the backend');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"promote the component to a standalone package" gets raw_c >= 2', () => {
    const text = normalize('promote the component to a standalone package');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  // Full pipeline: the shadow-mode example should score at least sonnet/med

  it('"make the adaptive UI skill a completely independent project" scores at least sonnet/med', () => {
    const result = fullScore('make the adaptive UI skill a completely independent project');
    assert.ok(
      result.tierIndex >= tierIndex('sonnet/med'),
      `Expected at least sonnet/med (${tierIndex('sonnet/med')}), got ${result.tier} (${result.tierIndex}). ` +
      `rawC=${result.rawC} C=${result.c}`
    );
  });

  // +deploy false positive guard

  it('"extract the auth module" does NOT trigger +deploy', () => {
    const text = normalize('extract the auth module');
    const { mods } = computeModifiers(text);
    assert.ok(
      !mods.includes('+deploy'),
      `Expected no +deploy on extraction prompt, got mods: [${mods}]`
    );
  });

  it('"deploy auth to production" still triggers +deploy', () => {
    const text = normalize('deploy auth to production');
    const { mods } = computeModifiers(text);
    assert.ok(
      mods.includes('+deploy'),
      `Expected +deploy on real deploy prompt, got mods: [${mods}]`
    );
  });

  it('"merge the utils into the main package" does NOT trigger +deploy (project-org guard)', () => {
    const text = normalize('merge the utils into the main package');
    const { mods } = computeModifiers(text);
    assert.ok(
      !mods.includes('+deploy'),
      `Expected no +deploy on merge-into-package, got mods: [${mods}]`
    );
  });

  // Control case: trivial prompt stays low

  it('"rename this variable" still scores haiku/low (no regression)', () => {
    const result = fullScore('rename this variable');
    assert.strictEqual(
      result.tier, 'haiku/low',
      `Expected haiku/low, got ${result.tier} (${result.tierIndex})`
    );
  });

  // Additional: extraction shorthand

  it('"extract the auth module" (bare, no "into") still gets raw_c >= 2', () => {
    const text = normalize('extract the auth module');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });

  it('"split the monorepo out into separate repos" gets raw_c >= 2', () => {
    const text = normalize('split the monorepo out into separate repos');
    const rawC = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
    assert.ok(rawC >= 2, `Expected raw_c >= 2, got ${rawC}`);
  });
});
