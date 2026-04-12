# Neurotokens -- Adaptive Thinking Allocation Policy

## Purpose

A `[neurotoken]` classification is injected into every prompt by a UserPromptSubmit hook. It encodes complexity (C) and stakes (S) scores, plus optional de-escalation modifiers (e.g., `-readonly`, `-briefok`, `-mechanical`). Use it to calibrate reasoning depth and agent selection according to the matrix below.

## The Adaptive Matrix

| | S=0 (Routine) | S=1 (Moderate) | S=2 (High) | S=3 (Critical) |
|---|---|---|---|---|
| C=0 (Trivial) | haiku/low | haiku/med | sonnet/med | opus/med |
| C=1 (Low) | haiku/med | sonnet/med | sonnet/high | opus/med |
| C=2 (Medium) | sonnet/med | sonnet/high | opus/med | opus/high |
| C=3 (High) | opus/med | opus/med | opus/high | opus/max |

Complexity = reasoning difficulty. Stakes = impact radius of a wrong answer.

## Behavioral Guidance

**haiku/low-med** -- Brief, direct answers. One-pass reasoning. No extended analysis. Skip code tracing. Suitable agents: researcher, job-scout, health-monitor, code-simplifier.

**sonnet/med** -- Standard analysis. Read relevant code, one layer of reasoning, address directly. Suitable agents: code-reviewer, company-researcher, test-generator, network-agent.

**sonnet/high-max** -- Deep single-domain analysis. Trace logic through multiple files, consider edge cases, verify assumptions. Suitable agents: security-reviewer, code-reviewer (thorough).

**opus/med** -- Broad expert reasoning at moderate depth. Architecture review, cross-system awareness. Handle directly or dispatch to opus-class agents (application-prep, interview-prep).

**opus/high** -- Full cross-system reasoning. Multi-file tracing, security analysis, design decisions. Handle directly.

**opus/max** -- Maximum depth. Novel architecture, critical production changes, auth/RLS modifications. Exhaustive analysis. No shortcuts. Consider all edge cases before proposing changes.

**Important**: These are behavioral guidelines, not hard constraints. Claude should use judgment -- if a recommendation seems misaligned with the actual prompt intent, note the mismatch transparently and adjust behavior accordingly.

## Orchestrator Dispatch Rules

1. **Floor rule**: Agent frontmatter model/effort is the minimum. Neurotokens can escalate, never downgrade. If the recommendation exceeds all available agents' capabilities, the orchestrator handles the task directly.

2. **Subagent context**: Subagents do NOT inherit the parent's `[neurotoken]` context. When the orchestrator dispatches to a subagent and the neurotoken tier exceeds the agent's default, include the recommendation and reasoning context in the subagent's task description.

3. **Multi-step tasks**: For tasks that span multiple agents (e.g., "review then fix then test"), use the highest single-step tier for the overall task classification.

## Multi-Turn Awareness

The hook persists a decaying high-water mark (HWM). If you see `(hwm decay: was X)` in the annotation, the prior turn had higher stakes/complexity. Treat the current turn in that established context -- short follow-up prompts like "ok do it" or "make that change" carry the weight of the prior discussion.

## User Overrides

Users can include override phrases in their prompts:

- **Escalation**: "think harder", "think more", "go deeper", "be thorough", "max effort", "ultrathink"
- **De-escalation**: "quick answer", "just tell me", "brief", "tl;dr", "think less"

The hook detects these AND you should honor them directly. User overrides bypass modifier caps and take precedence over all automated scoring.

## Transparency

Raw scores (C=X S=Y) are always visible in the injected context. If the user challenges a classification ("that was actually trivial" or "this is more critical than you think"), acknowledge the mismatch, adjust your behavior for the current response, and note it.

## Limitations

1. **Advisory only**: This system injects text recommendations. It cannot programmatically change the running model or effort level. The real actuator is orchestrator dispatch -- the orchestrator reads the recommendation and selects appropriate agents. In interactive (non-orchestrated) sessions, Claude adjusts reasoning depth based on the recommendation, but enforcement depends on Claude honoring the guidance.

2. **Keyword-based scoring**: Classification uses keyword and phrase matching (~85-90% accurate). It does not understand semantic meaning. A prompt discussing "production" conceptually may score differently than one intending to deploy to production.

3. **Code block handling**: Code fences and inline code are stripped before scoring, but code pasted without fences will still inflate scores.

4. **Multi-turn decay**: The high-water mark decays over ~5 minutes with time-proportional reduction. Very long pauses (>5 min) reset context entirely. Very rapid conversations may still see some score inflation from prior turns.
