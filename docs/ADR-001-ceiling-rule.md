# ADR-001: Ceiling-Rule Mode for Neurotoken Dispatch

## Status

Accepted, 2026-04-20

## Context

Neurotoken v1.0.0 enforces a floor rule: the agent's frontmatter model and effort level is the minimum, and Neurotoken scoring can only escalate upward. This is a safety-first design -- it prevents a low-scoring classification from accidentally throttling a high-stakes agent.

However, the floor rule alone does not serve cost-optimization use cases. Users who set their global model to Opus 4.7 (the strongest available tier) have no mechanism to route low-complexity, low-stakes work to cheaper models like Haiku or Sonnet. Every prompt -- regardless of whether it asks for a trivial file rename or a critical auth refactor -- consumes Opus-tier tokens. In orchestrator-based workflows where dozens of subagent dispatches occur per session, this cost accumulates quickly with no corresponding quality benefit.

Users have explicitly requested the inverse of the floor rule: set a high-tier global model as the ceiling, and let Neurotoken route downward when the scoring justifies it.

## Decision

Add `active-ceiling` as a new opt-in mode via `NEUROTOKEN_MODE=active-ceiling`. In this mode, the global model acts as the ceiling rather than the floor. The Neurotoken annotation includes an explicit downgrade permission when scoring indicates a lower-tier model is sufficient.

The floor rule remains the default behavior. Existing modes (`shadow`, `active`, `off`) are unchanged. This is a fully backwards-compatible addition.

Ceiling mode enforces strict safety guards: downgrade permission is never emitted when any of the following modifiers fire during scoring:

- `+auth` -- authentication or authorization logic
- `+deploy` -- deployment or infrastructure changes
- `+finance` -- financial data or transactions
- `+production` -- production environment modifications

When any of these modifiers are present, the annotation locks to the agent's configured tier regardless of the raw C/S scores.

## Consequences

**Positive**: Potential token savings in orchestrator-based workflows. Low-complexity prompts (file reads, simple lookups, mechanical refactors) route to Haiku or Sonnet, reserving Opus capacity for work that benefits from it. Actual cost reduction depends on prompt distribution and orchestrator adoption; no formal benchmark has been published as of this ADR.

**Negative**: Scoring accuracy becomes load-bearing. In floor-rule mode, an under-scored complex prompt simply runs at the agent's default tier -- no harm done. In ceiling mode, the same under-scored prompt routes to a cheaper model that may produce an inadequate response, costing more in retries than the original Opus call would have. This risk is mitigated by v1.1.0's imperative-extraction scoring improvements, which reduce under-scoring of action-oriented prompts.

**Neutral**: The annotation format changes in ceiling mode to include downgrade provenance (e.g., `downgrade OK from opus/max`), which orchestrators and logging tools must parse.

## Alternatives Considered

1. **Floor-only (status quo)**: Rejected. Does not address the cost-optimization use case that users are requesting.
2. **Pure ceiling with no safety guards**: Rejected. Allows downgrade on auth, deploy, and production prompts -- unacceptable safety risk.
3. **v2.0.0 breaking change**: Rejected. An opt-in mode addition is cleaner than a major version bump. Existing users experience zero behavioral change.

## References

- [docs/neurotokens.md](neurotokens.md) -- Full adaptive matrix and behavioral guidance
- [docs/orchestrator-patch.md](orchestrator-patch.md) -- Orchestrator dispatch rules and tier mapping
