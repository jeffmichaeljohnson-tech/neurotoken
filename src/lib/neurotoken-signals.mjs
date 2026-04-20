#!/usr/bin/env node

// ── Neurotoken Signal Definitions ───────────────────────────────────
// The brain of the adaptive thinking allocation system.
// Exports constants, signal definitions, and scoring functions
// used by the scorer hook to determine model/effort tier.
// No external dependencies — pure Node.js ESM.
// All text matching assumes input is already lowercased/normalized.
// ────────────────────────────────────────────────────────────────────


// ── Tier Definitions ────────────────────────────────────────────────

export const TIER_ORDER = [
  'haiku/low',    // 0
  'haiku/med',    // 1
  'haiku/high',   // 2
  'sonnet/low',   // 3
  'sonnet/med',   // 4
  'sonnet/high',  // 5
  'sonnet/max',   // 6
  'opus/low',     // 7
  'opus/med',     // 8
  'opus/high',    // 9
  'opus/max',     // 10
];


// ── Complexity x Stakes Matrix ──────────────────────────────────────
// MATRIX[complexity][stakes] → index into TIER_ORDER

export const MATRIX = [
  //        S=0  S=1  S=2  S=3
  /* C=0 */ [ 0,   1,   4,   8],
  /* C=1 */ [ 1,   4,   5,   8],
  /* C=2 */ [ 4,   5,   8,   9],
  /* C=3 */ [ 8,   8,   9,  10],
];


// ── Bucketing Thresholds ────────────────────────────────────────────
// Raw score → bucket: 0-1→0, 2-4→1, 5-8→2, 9+→3

// Lowered first threshold from 3→2 so a single keyword hit (2 pts)
// crosses into bucket 1. Aligns with asymmetric bias: over-classifying
// stakes is cheaper than under-classifying.
export const THRESHOLDS = [2, 5, 9];


// ── Signal Definitions ──────────────────────────────────────────────

export const COMPLEXITY_SIGNALS = {
  phraseWeight: 4,
  phrases: [
    'system architecture',
    'design pattern',
    'state machine',
    'race condition',
    'concurrency',
    'database migration',
    'schema migration',
    'refactor the architecture',
    'distributed system',
    'type system',
    'dynamic programming',
    'graph traversal',
    'build pipeline',
    'ci/cd pipeline',
    'from scratch',
    'greenfield',
    'event sourcing',
    'message queue',
    'load balancing',
    'service mesh',
  ],
  keywordWeight: 2,
  keywords: [
    'architect',
    'abstraction',
    'polymorphism',
    'decorator',
    'invalidation',
    'memoization',
    'query optimization',
    'monorepo',
    'turborepo',
    'oauth',
    'jwt',
    'websocket',
    'graphql',
    'parser',
    'ast',
    'recursive',
    'algorithm',
    'sharding',
    'replication',
  ],
  weakKeywordWeight: 1,
  weakKeywords: [
    'interface',
    'async',
    'middleware',
    'proxy',
    'cache',
  ],
};

export const STAKES_SIGNALS = {
  phraseWeight: 5,
  phrases: [
    'production database',
    'deploy to production',
    'user data',
    'personal data',
    'pii',
    'rls policy',
    'row level security',
    'authentication flow',
    'authorization',
    'api key',
    'credential',
    'delete from',
    'drop table',
    'push to main',
    'merge to main',
    'truncate table',
    'force push',
    'payment processing',
    'credit card',
    'hipaa',
    'gdpr',
  ],
  keywordWeight: 2,
  keywords: [
    'production',
    'prod',
    'deploy',
    'security',
    'vulnerability',
    'password',
    'encrypt',
    'rollback',
    'user-facing',
    'customer',
    'rls',
    'permission',
    'stripe',
    'payment',
    'billing',
    'secret',
    'certificate',
    'ssl',
    'tls',
  ],
  weakKeywordWeight: 1,
  weakKeywords: [
    'main',
    'env',
    'database',
    'token',
    'migration',
    'policy',
    'supabase',
    'auth',
  ],
};


// ── Verb Dictionaries ───────────────────────────────────────────────

const READ_ONLY_VERBS = [
  // Multi-word phrases first (checked before single words)
  'learn about',
  'what is',
  'how does',
  'tell me about',
  'look at',
  // Single words
  'explain',
  'show',
  'list',
  'describe',
  'understand',
  'summarize',
  'read',
  'check',
  'view',
  'review',
  'analyze',
];

const MUTATING_VERBS = [
  'delete',
  'drop',
  'remove',
  'modify',
  'change',
  'update',
  'disable',
  'add',
  'create',
  'insert',
  'alter',
  'replace',
  'rewrite',
  'fix',
  'patch',
  'deploy',
  'push',
  'merge',
  'migrate',
  'truncate',
];


// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ── Core Functions ──────────────────────────────────────────────────

/**
 * Bucket a raw score into 0-3 using THRESHOLDS.
 * 0-1 → 0, 2-4 → 1, 5-8 → 2, 9+ → 3
 */
export function bucket(raw) {
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (raw < THRESHOLDS[i]) return i;
  }
  return 3;
}

/**
 * Score normalized text against a signal set.
 * Returns the raw integer score.
 */
export function scoreDimension(normalizedText, signals) {
  let score = 0;

  // Phrase matching — substring inclusion
  for (const phrase of signals.phrases) {
    if (normalizedText.includes(phrase)) {
      score += signals.phraseWeight;
    }
  }

  // Keyword matching — word-boundary regex, with diminishing returns
  let keywordHits = 0;
  for (const keyword of signals.keywords) {
    const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`);
    if (pattern.test(normalizedText)) {
      keywordHits++;
      score += keywordHits <= 4 ? signals.keywordWeight : 1;
    }
  }

  // Weak keyword matching (if present)
  if (signals.weakKeywords) {
    for (const keyword of signals.weakKeywords) {
      const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`);
      if (pattern.test(normalizedText)) {
        keywordHits++;
        score += keywordHits <= 4 ? signals.weakKeywordWeight : 1;
      }
    }
  }

  return score;
}

const EXTRACTION_PATTERNS = [
  /\bmake\b.{1,40}\bindependent\b/,
  /\bmake\b.{1,40}\bstandalone\b/,
  /\bextract\b.{1,40}\binto\b/,
  /\bextract\b\s+(?:the\s+)?\w+/,
  /\bmove\b.{1,40}\brepo\b/,
  /\bmove\b.{1,40}\bits own\b/,
  /\bmigrate\b.{1,40}\bto\b/,
  /\brefactor\b.{1,40}\binto\b/,
  /\brefactor\b.{1,40}\bto\b/,
  /\bsplit\b.{1,40}\binto\b/,
  /\bsplit\b.{1,40}\bout\b/,
  /\bseparate\b.{1,40}\bfrom\b/,
  /\bseparate\b.{1,40}\binto\b/,
  /\bpromote\b.{1,40}\bto\b/,
  /\bmerge\b.{1,40}\binto\b.{1,40}\b(package|module|project|repo|codebase|monorepo)\b/,
];

/**
 * Compute structural bonus points for complexity.
 * Detects multi-file references, concept density, multi-step instructions,
 * and imperative extraction patterns (terse architectural prompts).
 */
export function structuralBonus(normalizedText) {
  let bonus = 0;

  // Imperative extraction (+5): terse prompts that imply architectural work
  // Needs to reach C=2 bucket (threshold 5) to avoid under-routing to haiku
  for (const pattern of EXTRACTION_PATTERNS) {
    if (pattern.test(normalizedText)) {
      bonus += 5;
      break;
    }
  }

  // Multi-file (+3): detect 2+ unique file paths
  const filePathPattern = /(?:src|app|lib|components)\/[\w./-]+|[\w/-]+\.(?:ts|tsx|mjs|jsx|js|py|swift|rs|go|sql)\b/g;
  const matches = normalizedText.match(filePathPattern);
  if (matches) {
    const unique = new Set(matches);
    if (unique.size >= 2) {
      bonus += 3;
    }
  }

  // Concept density (+2): >150 words AND 3+ complexity keywords
  const words = normalizedText.split(/\s+/);
  if (words.length > 150) {
    let complexityKeywordCount = 0;
    for (const kw of COMPLEXITY_SIGNALS.keywords) {
      const pattern = new RegExp(`\\b${escapeRegex(kw)}\\b`);
      if (pattern.test(normalizedText)) {
        complexityKeywordCount++;
      }
    }
    // Also count complexity phrases
    for (const phrase of COMPLEXITY_SIGNALS.phrases) {
      if (normalizedText.includes(phrase)) {
        complexityKeywordCount++;
      }
    }
    if (complexityKeywordCount >= 3) {
      bonus += 2;
    }
  }

  // Multi-step (+1, only for non-trivial prompts): "first...then", numbered lists, step references
  if (words.length > 30) {
    const hasFirstThen = /\bfirst\b[\s\S]*?\bthen\b/.test(normalizedText);
    const hasNumberedList = /\b1[.)]\s[\s\S]*?\b2[.)]\s/.test(normalizedText);
    const hasStepRefs = /\bstep\s*1\b[\s\S]*?\bstep\s*2\b/.test(normalizedText);
    if (hasFirstThen || hasNumberedList || hasStepRefs) {
      bonus += 1;
    }
  }

  return bonus;
}

/**
 * Detect the primary verb in normalized text.
 * Returns { verb, type } where type is 'readonly', 'mutating', or 'unknown'.
 * Position-aware: the verb appearing earliest in the text wins.
 * Mutating verbs are preferred when within 3 characters of a read-only verb (safety bias).
 */
export function detectPrimaryVerb(normalizedText) {
  const candidates = [];

  // Check read-only verbs
  for (const verb of READ_ONLY_VERBS) {
    if (verb.includes(' ')) {
      // Multi-word phrases: use includes (unlikely to be substrings)
      const idx = normalizedText.indexOf(verb);
      if (idx !== -1) candidates.push({ verb, type: 'readonly', pos: idx });
    } else {
      // Single words: use word-boundary regex to avoid substring matches
      const match = new RegExp(`\\b${escapeRegex(verb)}\\b`).exec(normalizedText);
      if (match) candidates.push({ verb, type: 'readonly', pos: match.index });
    }
  }

  // Check mutating verbs
  for (const verb of MUTATING_VERBS) {
    const match = new RegExp(`\\b${escapeRegex(verb)}\\b`).exec(normalizedText);
    if (match) candidates.push({ verb, type: 'mutating', pos: match.index });
  }

  if (candidates.length === 0) return { verb: null, type: 'unknown' };

  // Sort by position (earliest first), prefer mutating on ties
  candidates.sort((a, b) => {
    const posDiff = a.pos - b.pos;
    if (Math.abs(posDiff) <= 3) {
      // Within 3 chars: prefer mutating (safety bias)
      if (a.type === 'mutating' && b.type !== 'mutating') return -1;
      if (b.type === 'mutating' && a.type !== 'mutating') return 1;
    }
    return posDiff;
  });

  return { verb: candidates[0].verb, type: candidates[0].type };
}

/**
 * Context dampening: reduce stakes score when high-stakes keywords
 * appear near dampening/qualifying words within a 5-word window.
 * Returns 0 or -1.
 */
export function contextDampening(normalizedText) {
  const windows = [
    {
      trigger: 'deploy',
      dampeners: ['test', 'local', 'staging', 'dry run', 'sandbox', 'dev'],
    },
    {
      trigger: 'delete',
      dampeners: ['test', 'temp', 'cache', 'old', 'unused', 'mock'],
    },
    {
      trigger: 'remove',
      dampeners: ['test', 'temp', 'cache', 'old', 'unused', 'mock'],
    },
    {
      trigger: 'drop',
      dampeners: ['test', 'temp', 'cache', 'old', 'unused', 'mock'],
    },
    {
      trigger: 'production',
      dampeners: ['like', 'similar to', 'example', 'about', 'learn', 'explain'],
    },
    {
      trigger: 'prod',
      dampeners: ['like', 'similar to', 'example', 'about', 'learn', 'explain'],
    },
  ];

  const words = normalizedText.split(/\s+/);

  for (const { trigger, dampeners } of windows) {
    // Find indices of trigger word
    for (let i = 0; i < words.length; i++) {
      if (words[i] === trigger || words[i].startsWith(trigger)) {
        // Check 5-word window around the trigger
        const windowStart = Math.max(0, i - 5);
        const windowEnd = Math.min(words.length, i + 6);
        const windowText = words.slice(windowStart, windowEnd).join(' ');

        for (const dampener of dampeners) {
          if (windowText.includes(dampener)) {
            return -1;
          }
        }
      }
    }
  }

  return 0;
}

/**
 * Compute modifier shifts from escalation and de-escalation triggers.
 * Returns { shift, mods } where shift is the net modifier and
 * mods is an array of triggered modifier labels.
 *
 * Escalation: +1 each, capped at +2 total.
 * De-escalation: -1 each, capped at -1 total (asymmetric bias).
 */
export function computeModifiers(normalizedText) {
  const mods = [];
  let escalation = 0;
  let deescalation = 0;

  const { type: verbType } = detectPrimaryVerb(normalizedText);
  const isMutating = verbType === 'mutating';

  // ── Escalation triggers ─────────────────────────────────────────

  // Auth/RLS + mutating verb
  const hasAuth = /\b(auth|rls|row level security|permission|policy)\b/.test(normalizedText);
  if (hasAuth && isMutating) {
    escalation++;
    mods.push('+auth');
  }

  // Deploy/push/merge + production context (without dampening)
  // Guard: project-organization contexts (extract, split, separate, etc.)
  // use "merge/push" + "main" in a restructuring sense, not a deploy sense
  const hasDeployAction = /\b(deploy|push|merge)\b/.test(normalizedText);
  const hasProdTarget = /\b(production|prod|main|live)\b/.test(normalizedText);
  const isDampened = contextDampening(normalizedText) < 0;
  const isProjectOrg = EXTRACTION_PATTERNS.some(p => p.test(normalizedText));
  if (hasDeployAction && hasProdTarget && !isDampened && !isProjectOrg) {
    escalation++;
    mods.push('+deploy');
  }

  // Financial keywords + mutating verb
  const hasFinance = /\b(stripe|payment|billing|invoice|credit card|refund|charge)\b/.test(normalizedText);
  if (hasFinance && isMutating) {
    escalation++;
    mods.push('+finance');
  }

  // Cross-project detection: set NEUROTOKEN_PROJECTS env var as comma-separated list
  // e.g. "my-app,my-api,shared-lib"
  const projectNames = process.env.NEUROTOKEN_PROJECTS
    ? process.env.NEUROTOKEN_PROJECTS.split(',').map(s => s.trim().toLowerCase())
    : [];
  let projectCount = 0;
  for (const name of projectNames) {
    if (normalizedText.includes(name)) {
      projectCount++;
    }
  }
  const hasCrossPhrase = /\bcross-project\b|\bcross-repo\b/.test(normalizedText);
  if (projectCount >= 2 || hasCrossPhrase) {
    escalation++;
    mods.push('+cross-project');
  }

  // Novel architecture
  const hasNovel = /\b(new architecture|new system|greenfield|from scratch)\b/.test(normalizedText);
  if (hasNovel) {
    escalation++;
    mods.push('+novel');
  }

  // Cap escalation at +2
  escalation = Math.min(escalation, 2);

  // ── De-escalation triggers ──────────────────────────────────────

  // Test context without production signals
  const hasTest = /\b(test|spec|jest|vitest|mock|stub|fixture|unit test|e2e)\b/.test(normalizedText);
  const hasProd = /\b(production|prod)\b/.test(normalizedText);
  if (hasTest && !hasProd) {
    deescalation--;
    mods.push('-test');
  }

  // Docs without mutating verbs
  const hasDocs = /\b(readme|documentation|docs|jsdoc|comment|changelog|guide)\b/.test(normalizedText);
  if (hasDocs && !isMutating) {
    deescalation--;
    mods.push('-docs');
  }

  // Formatting
  const hasFormat = /\b(format|prettier|eslint|lint|indent|whitespace|trailing)\b/.test(normalizedText);
  if (hasFormat) {
    deescalation--;
    mods.push('-format');
  }

  // Read-only intent without any mutating context
  if (verbType === 'readonly' && !isMutating) {
    // Double-check: no mutating verbs anywhere in the text
    const hasMutatingAnywhere = MUTATING_VERBS.some(v => {
      const pattern = new RegExp(`\\b${escapeRegex(v)}\\b`);
      return pattern.test(normalizedText);
    });
    if (!hasMutatingAnywhere) {
      deescalation--;
      mods.push('-readonly');
    }
  }

  // Cap de-escalation at -1
  deescalation = Math.max(deescalation, -1);

  return {
    shift: escalation + deescalation,
    mods,
  };
}

/**
 * Detect explicit user override phrases.
 * Returns { phrase, shift } or null if no override detected.
 */
export function detectUserOverride(normalizedText) {
  // Check in order from strongest to weakest within each direction
  const overrides = [
    // Strong escalation (+2)
    { phrase: 'think harder',     shift: 2 },
    { phrase: 'max effort',       shift: 2 },
    { phrase: 'go all out',       shift: 2 },
    { phrase: 'ultrathink',       shift: 2 },
    // Mild escalation (+1)
    { phrase: 'think more',       shift: 1 },
    { phrase: 'go deeper',        shift: 1 },
    { phrase: 'be thorough',      shift: 1 },
    { phrase: 'think carefully',  shift: 1 },
    // Mild de-escalation (-1)
    { phrase: 'quick answer',     shift: -1 },
    { phrase: 'just tell me',     shift: -1 },
    { phrase: 'brief',            shift: -1 },
    { phrase: 'tl;dr',            shift: -1 },
    { phrase: 'tldr',             shift: -1 },
    // Strong de-escalation (-2)
    { phrase: 'think less',       shift: -2 },
    { phrase: 'think minimally',  shift: -2 },
    { phrase: 'fastest possible', shift: -2 },
  ];

  for (const override of overrides) {
    if (normalizedText.includes(override.phrase)) {
      return { phrase: override.phrase, shift: override.shift };
    }
  }

  return null;
}
