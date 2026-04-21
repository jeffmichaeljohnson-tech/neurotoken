#!/usr/bin/env node
// neurotoken-scorer.mjs — Claude Code UserPromptSubmit hook
// Scores prompts on complexity + stakes, recommends a model tier.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TIER_ORDER, MATRIX, bucket,
  COMPLEXITY_SIGNALS, STAKES_SIGNALS,
  scoreDimension, structuralBonus, detectPrimaryVerb,
  contextDampening, computeModifiers, detectUserOverride,
} from './lib/neurotoken-signals.mjs';
import { normalize } from './lib/normalize.mjs';

const mode = process.env.NEUROTOKEN_MODE || 'shadow';
if (mode === 'off') process.exit(0);

const clamp = (v) => Math.max(0, Math.min(10, v));

// Ceiling-rule mode (v1.1.0+): when NEUROTOKEN_MODE=active-ceiling, permit
// downgrade to cheaper models for low-tier work. The ceiling (user's global
// model) defaults to opus/max; override via NEUROTOKEN_CEILING.
const CEILING_MODS = new Set(['+auth', '+deploy', '+finance', '+cross-project']);

try {
  // Read and validate input
  const { prompt } = JSON.parse(readFileSync(0, 'utf8'));
  if (!prompt || prompt.length < 3) process.exit(0);
  const text = normalize(prompt);

  // Score complexity and stakes
  let rawComplexity = scoreDimension(text, COMPLEXITY_SIGNALS) + structuralBonus(text);
  let rawStakes = scoreDimension(text, STAKES_SIGNALS);

  // Verb-aware: read-only verbs reduce stakes by keyword weight (2)
  const verb = detectPrimaryVerb(text);
  if (verb.type === 'readonly' && rawStakes > 0) rawStakes = Math.max(0, rawStakes - 2);

  // Context dampening (returns 0 or negative), clamp to 0
  rawStakes = Math.max(0, rawStakes + contextDampening(text));

  const c = bucket(rawComplexity);
  const s = bucket(rawStakes);
  let tierIndex = MATRIX[c][s];

  // Detect user override up-front — it takes precedence over automated scoring,
  // which includes the HWM floor below.
  const override = detectUserOverride(text);

  // High-water mark — decaying floor over 5 minutes, absolute expiry at 10 min.
  // Gated so only terse follow-ups ("ok do it", "yes", "proceed") inherit weight
  // from prior turns — fresh-task prompts set their own weight. Also skipped when
  // the user explicitly overrides: "quick answer" should not be silently upgraded.
  let usedHwm = false;
  let hwmTs = Date.now();  // default for new HWM entries
  let hwmOriginalTier = null;
  const intrinsicTierIndex = tierIndex;  // save before HWM boost
  const hwmPath = join(tmpdir(), 'neurotoken-hwm.json');

  const TERSE_FOLLOWUPS = /^(ok|okay|yes|yep|yeah|sure|go|do it|proceed|continue|go ahead|sounds good|lgtm|ship it|confirmed|approved|right|correct|exactly|perfect|fine|great|please|thanks|y|k)\b/i;
  const isTerseFollowup = text.length < 40 && TERSE_FOLLOWUPS.test(text);

  if (existsSync(hwmPath) && !override) {
    try {
      const hwm = JSON.parse(readFileSync(hwmPath, 'utf8'));
      const elapsed = Date.now() - hwm.ts;
      const HWM_DECAY_WINDOW = 5 * 60_000;
      const HWM_ABSOLUTE_EXPIRY = 10 * 60_000;
      const hwmValid = elapsed < HWM_ABSOLUTE_EXPIRY
        && elapsed < HWM_DECAY_WINDOW
        && isTerseFollowup;
      if (hwmValid && tierIndex < hwm.score) {
        const decay = Math.ceil(elapsed / 60_000) || 1;  // at least 1
        const decayedScore = hwm.score - decay;
        if (decayedScore > tierIndex) {
          tierIndex = decayedScore;
          usedHwm = true;
          hwmTs = hwm.ts;  // preserve original timestamp — don't refresh
          hwmOriginalTier = hwm.score;
        }
      }
    } catch { /* corrupted file */ }
  }

  // Modifiers and user overrides
  const { shift: modShift, mods } = computeModifiers(text);
  tierIndex = clamp(tierIndex + modShift);
  if (override) tierIndex = clamp(tierIndex + override.shift);

  // Persist — only refresh timestamp if this prompt's own score is the new high
  writeFileSync(hwmPath, JSON.stringify({
    score: tierIndex,
    ts: intrinsicTierIndex >= tierIndex ? Date.now() : hwmTs,
  }));

  // Build recommendation + annotation string
  const recommendation = TIER_ORDER[tierIndex];
  let annotation = '';
  if (mods.length) annotation += ` (${mods.join(', ')})`;
  if (override) annotation += ` (user: ${override.shift > 0 ? '+' : ''}${override.shift} "${override.phrase}")`;
  if (usedHwm && hwmOriginalTier !== null) annotation += ` (hwm decay: ${TIER_ORDER[intrinsicTierIndex]} → ${TIER_ORDER[tierIndex]})`;

  // Ceiling-rule mode: compute whether downgrade is permitted.
  // Safety guard: any of +auth/+deploy/+finance/+cross-project OR S=3 blocks downgrade.
  let downgradeOk = false;
  let ceilingTier = null;
  if (mode === 'active-ceiling') {
    ceilingTier = process.env.NEUROTOKEN_CEILING || 'opus/max';
    const ceilingIdx = TIER_ORDER.indexOf(ceilingTier);
    const hasSafetyMod = mods.some(m => CEILING_MODS.has(m));
    const criticalStakes = s === 3;
    if (ceilingIdx >= 0 && tierIndex < ceilingIdx && !hasSafetyMod && !criticalStakes) {
      downgradeOk = true;
      annotation += ` (downgrade OK from ${ceilingTier})`;
    }
  }

  // Log to JSONL (always, all modes)
  appendFileSync(join(tmpdir(), 'neurotoken-log.jsonl'), JSON.stringify({
    ts: new Date().toISOString(), mode,
    session: process.env.NEUROTOKEN_SESSION || '?',
    prompt_preview: prompt.slice(0, 80),
    c, s, raw_c: rawComplexity, raw_s: rawStakes,
    tier: recommendation, mods, verb: verb.verb, hwm_applied: usedHwm,
    downgrade_ok: downgradeOk, ceiling: ceilingTier,
  }) + '\n');

  // Shadow mode: log only, no output
  if (mode === 'shadow') process.exit(0);

  // Active / active-ceiling: inject context into Claude Code
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[neurotoken] C=${c} S=${s} \u2192 ${recommendation}${annotation}`,
    },
  }));

} catch (err) {
  // Crash resilience: never block the user's prompt
  if (mode === 'active' || mode === 'active-ceiling') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '[neurotoken] scoring failed \u2014 using session defaults',
      },
    }));
  }
  process.exit(0);
}
