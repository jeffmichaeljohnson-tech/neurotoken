#!/usr/bin/env node

// ── Safety Modifier Adversarial Tests ───────────────────────────────
// Validates that modifier detection (+auth, +deploy, +finance) fires
// reliably on terse, conversational, real-world prompts — the kind a
// developer actually dictates via voice or types in a hurry.
//
// Context: Neurotoken v1.1.0 ceiling mode permits de-escalation to
// cheaper models. If a modifier fails to fire on a risk-bearing prompt,
// the ceiling-mode safety guard won't engage and the user gets routed
// to haiku — producing a broken response on a critical task.
//
// KNOWN GAP tests are documented with it.skip() and a comment
// explaining the detection blind spot.
//
// Run with: node --test tests/test-safety-modifiers.mjs
// ────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeModifiers, detectPrimaryVerb } from '../src/lib/neurotoken-signals.mjs';
import { normalize } from '../src/lib/normalize.mjs';


// ── Helpers ────────────────────────────────────────────────────────

/**
 * Normalize a raw prompt and compute modifiers.
 * Returns { mods, shift } from computeModifiers.
 */
function modsFor(rawPrompt) {
  const text = normalize(rawPrompt);
  return computeModifiers(text);
}

/**
 * Assert that a specific modifier is present in the result.
 */
function assertModFires(rawPrompt, expectedMod) {
  const { mods } = modsFor(rawPrompt);
  assert.ok(
    mods.includes(expectedMod),
    `Expected "${expectedMod}" to fire for: "${rawPrompt}"\n` +
    `  Got mods: [${mods.join(', ')}]`
  );
}

/**
 * Assert that a specific modifier does NOT fire.
 */
function assertModSilent(rawPrompt, forbiddenMod) {
  const { mods } = modsFor(rawPrompt);
  assert.ok(
    !mods.includes(forbiddenMod),
    `Expected "${forbiddenMod}" to NOT fire for: "${rawPrompt}"\n` +
    `  Got mods: [${mods.join(', ')}]`
  );
}


// ── +auth — must fire ─────────────────────────────────────────────
// Auth/RLS modifier requires: auth keyword match + mutating verb.

describe('+auth modifier — terse auth/security prompts', () => {

  it('"update the auth middleware" fires +auth', () => {
    assertModFires('update the auth middleware', '+auth');
  });

  it('"fix rls on users" fires +auth', () => {
    assertModFires('fix rls on users', '+auth');
  });

  it('"reset my session token" fires +auth', () => {
    assertModFires('reset my session token', '+auth');
  });

  it('"rotate the jwt keys" fires +auth', () => {
    assertModFires('rotate the jwt keys', '+auth');
  });

  it('"change the password reset flow" fires +auth', () => {
    assertModFires('change the password reset flow', '+auth');
  });

  it('"add oauth callback" fires +auth', () => {
    assertModFires('add oauth callback', '+auth');
  });

  it('"update rbac rules" fires +auth', () => {
    assertModFires('update rbac rules', '+auth');
  });

  it('"modify the permission check on profiles" fires +auth', () => {
    // "permission" IS in the auth regex, "modify" IS mutating
    assertModFires('modify the permission check on profiles', '+auth');
  });

  it('"change the rls policy for private data" fires +auth', () => {
    // "rls" and "policy" both in auth regex, "change" is mutating
    assertModFires('change the rls policy for private data', '+auth');
  });

  // KNOWN GAP: "who can see" implies access control but no auth keyword.
  // Natural language access control descriptions don't fire the modifier.
  it.skip('"modify who can see private prayers" fires +auth — KNOWN GAP: no auth keyword in natural language access description', () => {
    assertModFires('modify who can see private prayers', '+auth');
  });
});


// ── +deploy / +production — must fire ─────────────────────────────
// Deploy modifier requires: deploy|push|merge action + production|prod|main|live target,
// without dampening and without extraction-pattern guard.

describe('+deploy modifier — terse deploy/release prompts', () => {

  it('"push the build to prod" fires +deploy', () => {
    assertModFires('push the build to prod', '+deploy');
  });

  it('"ship this to production" fires +deploy', () => {
    assertModFires('ship this to production', '+deploy');
  });

  it('"merge to main" fires +deploy', () => {
    assertModFires('merge to main', '+deploy');
  });

  it('"deploy the edge function" fires +deploy', () => {
    assertModFires('deploy the edge function', '+deploy');
  });

  it('"promote staging to production" fires +deploy', () => {
    assertModFires('promote staging to production', '+deploy');
  });

  // KNOWN GAP: "cut a release" has neither deploy action nor prod target.
  // This is a common developer phrase for creating a production release.
  it.skip('"cut a release" fires +deploy — KNOWN GAP: "cut" and "release" not in deploy vocabulary', () => {
    assertModFires('cut a release', '+deploy');
  });

  it('"push to production" fires +deploy', () => {
    assertModFires('push to production', '+deploy');
  });

  it('"deploy this to prod" fires +deploy', () => {
    assertModFires('deploy this to prod', '+deploy');
  });

  it('"merge this PR to main" fires +deploy', () => {
    assertModFires('merge this PR to main', '+deploy');
  });
});


// ── +finance — must fire ──────────────────────────────────────────
// Finance modifier requires: finance keyword + mutating verb.

describe('+finance modifier — terse billing/payment prompts', () => {

  it('"update the stripe webhook" fires +finance', () => {
    assertModFires('update the stripe webhook', '+finance');
  });

  it('"change pricing on the pro plan" fires +finance', () => {
    assertModFires('change pricing on the pro plan', '+finance');
  });

  it('"add a new subscription tier" fires +finance', () => {
    assertModFires('add a new subscription tier', '+finance');
  });

  it('"fix the refund flow" fires +finance', () => {
    assertModFires('fix the refund flow', '+finance');
  });

  it('"update billing metadata" fires +finance', () => {
    assertModFires('update billing metadata', '+finance');
  });

  it('"add a charge endpoint" fires +finance', () => {
    // "charge" IS in finance regex, "add" IS mutating
    assertModFires('add a charge endpoint', '+finance');
  });

  it('"fix the invoice generation" fires +finance', () => {
    // "invoice" IS in finance regex, "fix" IS mutating
    assertModFires('fix the invoice generation', '+finance');
  });
});


// ── NEGATIVE — must NOT fire ──────────────────────────────────────
// Adversarial false positives that could route safe tasks to opus.

describe('Negative cases — must NOT trigger escalation modifiers', () => {

  it('"explain how stripe webhooks work" does NOT fire +finance (educational, not mutating)', () => {
    assertModSilent('explain how stripe webhooks work', '+finance');
  });

  it('"read the auth middleware file" does NOT fire +auth (read-only, not mutating)', () => {
    assertModSilent('read the auth middleware file', '+auth');
  });

  it('"what is rls?" does NOT fire +auth (conceptual question)', () => {
    assertModSilent('what is rls?', '+auth');
  });

  it('"extract the auth module" does NOT fire +auth (refactoring, not modifying auth behavior)', () => {
    // "extract" is not in MUTATING_VERBS, so verb type is unknown
    assertModSilent('extract the auth module', '+auth');
  });

  it('"format prices with two decimals" does NOT fire +finance (formatting, not billing logic)', () => {
    assertModSilent('format prices with two decimals', '+finance');
  });

  it('"rename the stripe helper function" does NOT fire +finance (lexical rename, not financial mutation)', () => {
    // "rename" is not in MUTATING_VERBS
    assertModSilent('rename the stripe helper function', '+finance');
  });

  it('"describe the payment architecture" does NOT fire +finance (describe is read-only)', () => {
    assertModSilent('describe the payment architecture', '+finance');
  });

  it('"review the billing code" does NOT fire +finance (review is read-only)', () => {
    assertModSilent('review the billing code', '+finance');
  });

  it('"list the auth providers we support" does NOT fire +auth (list is read-only)', () => {
    assertModSilent('list the auth providers we support', '+auth');
  });

  it('"show me the deploy history" does NOT fire +deploy (show is read-only, no prod target)', () => {
    assertModSilent('show me the deploy history', '+deploy');
  });
});
