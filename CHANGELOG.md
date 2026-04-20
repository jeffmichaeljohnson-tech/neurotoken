# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-20

### Added

- **Ceiling-rule mode** (opt-in): set `NEUROTOKEN_MODE=active-ceiling` to permit downgrade to cheaper models when scoring indicates the prompt is safely below your configured ceiling. Designed for users who set a high global model (e.g., Opus 4.7) and want Neurotoken to route low-stakes work to Haiku or Sonnet for cost savings.
- **`NEUROTOKEN_CEILING` env var** (default `opus/max`): configures the maximum tier the orchestrator may dispatch to in ceiling mode.
- **Imperative-extraction scoring**: terse architectural prompts like "make X independent", "extract X", "move X to repo", "refactor X into", "split X" now correctly score C≥1 via a new `EXTRACTION_PATTERNS` structural bonus (+5). Fixes under-scoring of action-oriented prompts where scope is implicit rather than stated in technical vocabulary.
- **Safety-modifier detection expanded**: `+auth`, `+deploy`, and `+finance` regexes now cover jwt, oauth, rbac, password, session token, ship, promote, publish, release, edge function, lambda, pricing, subscription, checkout, and related terms. Closes 10 gaps found via adversarial red-team testing that would have caused unsafe ceiling-mode downgrades.
- **MUTATING_VERBS expanded**: reset, rotate, revoke, grant, enable, install, configure, ship, promote, publish, release, rollout, uninstall. Needed for modifier detection to fire on real developer prompts.
- **HWM absolute expiry + fresh-task gate**: HWM (high-water mark) now expires after 10 minutes regardless of prompt type, and is only applied to terse conversational follow-ups (`ok`, `do it`, `yes`, `proceed`, `continue`, etc.). Fixes session-start pollution where stale HWM from a prior task would leak into a new task.
- **ADR-001**: documents the floor→ceiling philosophy shift and design rationale.
- **33 new tests**: `test-hwm-integration.mjs` (13), `test-extraction-patterns.mjs` (15), `test-ceiling-mode.mjs` (9), `test-safety-modifiers.mjs` (36 incl. 2 skipped for natural-language gaps).

### Fixed

- **User overrides no longer blocked by HWM floor** ([#previously-unreported]): `"quick answer: what time is it"` with a high HWM from a prior prompt was returning `sonnet/max` instead of `haiku/low`. Per policy, user overrides take precedence over all automated scoring (including HWM). Now detected up-front and bypasses the HWM boost entirely.
- **`+deploy` false positive on project-organization prompts**: `"make the adaptive UI skill a completely independent project"` no longer triggers `+deploy`. Agent-A's project-org guard suppresses the modifier when extraction patterns match. Unambiguous deploy targets (production, prod, live, edge function, lambda) override the guard.
- **Docs referenced a nonexistent `+production` modifier**: updated `docs/neurotokens.md`, `docs/orchestrator-patch.md`, and `docs/ADR-001-ceiling-rule.md` to correctly reference `+cross-project` and `S=3` as the safety-guard conditions that exist in the implementation.

### Changed

- Annotation format in ceiling mode includes `(downgrade OK from X)` suffix when downgrade is permitted. Floor mode annotations are unchanged.
- Orchestrator dispatch policy (`docs/orchestrator-patch.md`) now documents both floor-rule (default, escalate-only) and ceiling-rule (opt-in, permit downgrade) dispatch semantics with examples.

### Migration

This release is **fully backwards compatible**. Existing installations with `NEUROTOKEN_MODE=shadow` or `active` see no behavioral change. To opt into ceiling-rule de-escalation:

1. `./install.sh` to copy updated hook files
2. Set `NEUROTOKEN_MODE=active-ceiling` in your `settings.json` env
3. Optionally set `NEUROTOKEN_CEILING=opus/max` (or your preferred ceiling)
4. Restart your Claude Code session
5. For orchestrator dispatch to honor downgrade permission, append `docs/orchestrator-patch.md` to `~/.claude/agents/orchestrator.md`

### Known limitations

- Two natural-language modifier gaps remain (skipped tests document them): `"modify who can see private prayers"` doesn't fire `+auth` (no keyword in the access-control description), and `"cut a release"` doesn't fire `+deploy` (no keyword match). Both can be worked around by using more explicit vocabulary.

## [1.0.0] - 2026-04-XX

### Added

- Initial release: adaptive thinking allocation hook for Claude Code
- Floor-rule dispatch semantics (escalate only, never downgrade)
- Complexity × Stakes scoring on 0–3 axes
- 11-tier model recommendation from `haiku/low` to `opus/max`
- UserPromptSubmit hook with <100ms latency, zero dependencies
- Modifiers: `+auth`, `+deploy`, `+finance`, `+cross-project`, `+novel`; `-test`, `-docs`, `-format`, `-readonly`
- User overrides: "think harder" / "ultrathink" (+2), "quick answer" / "brief" (-1)
- 5-minute HWM decay for multi-turn context
- Shadow, active, and off modes
- 109 tests across 22 suites
