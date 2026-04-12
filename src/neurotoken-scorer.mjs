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

try {
  // Read and validate input
  const { prompt } = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
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

  // High-water mark — decaying floor over 5 minutes
  let usedHwm = false;
  let hwmTs = Date.now();  // default for new HWM entries
  let hwmOriginalTier = null;
  let intrinsicTierIndex = tierIndex;  // save before HWM boost
  const hwmPath = join(tmpdir(), 'neurotoken-hwm.json');
  if (existsSync(hwmPath)) {
    try {
      const hwm = JSON.parse(readFileSync(hwmPath, 'utf8'));
      const elapsed = Date.now() - hwm.ts;
      if (elapsed < 5 * 60_000 && tierIndex < hwm.score) {
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
  const override = detectUserOverride(text);
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

  // Log to JSONL (always, both modes)
  appendFileSync(join(tmpdir(), 'neurotoken-log.jsonl'), JSON.stringify({
    ts: new Date().toISOString(), mode,
    session: process.env.NEUROTOKEN_SESSION || '?',
    prompt_preview: prompt.slice(0, 80),
    c, s, raw_c: rawComplexity, raw_s: rawStakes,
    tier: recommendation, mods, verb: verb.verb, hwm_applied: usedHwm,
  }) + '\n');

  // Shadow mode: log only, no output
  if (mode === 'shadow') process.exit(0);

  // Active mode: inject context into Claude Code
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[neurotoken] C=${c} S=${s} \u2192 ${recommendation}${annotation}`,
    },
  }));

} catch (err) {
  // Crash resilience: never block the user's prompt
  if (mode === 'active') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '[neurotoken] scoring failed \u2014 using session defaults',
      },
    }));
  }
  process.exit(0);
}
