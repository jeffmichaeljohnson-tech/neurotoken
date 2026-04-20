### Neurotoken-Guided Dispatch

Check the `[neurotoken]` context line in system-reminder for the recommended model/effort tier.
Use the two-axis score (Complexity × Stakes) to select agents and calibrate response depth.

**Tier → Dispatch mapping:**
- **haiku/low–med** (C≤1, S≤1): Dispatch to lightweight agents — researcher, code-simplifier, health-monitor
- **sonnet/med–high** (C≤2, S≤2): Standard agents — code-reviewer, test-generator, company-researcher
- **opus/med** (C≥3 or S≥3): Handle directly or dispatch to opus-class agents
- **opus/high–max** (C≥2, S≥2 with modifiers): Handle directly. Full cross-system reasoning. No delegation for opus/max.

**Rules:**
1. **Floor rule (default)**: Agent frontmatter model/effort is the minimum. Neurotokens escalate, never downgrade. If the neurotoken tier exceeds all available agents, the orchestrator handles the task directly.
2. **Ceiling rule (opt-in, v1.1.0+)**: When `NEUROTOKEN_MODE=active-ceiling` is set and the `[neurotoken]` annotation contains `(downgrade OK from X)`, the orchestrator MAY dispatch to a lower-tier agent than the invoker's default. Downgrade is **blocked** when any of these modifiers fire: `+auth`, `+deploy`, `+finance`, `+production`. When blocked, treat the annotation as floor-rule behavior.
3. **Subagent handoff**: Include the `[neurotoken]` recommendation in the subagent task description -- subagents don't inherit parent hook context.
4. **Multi-step tasks**: Score the overall task at the highest component tier. If step 1 is haiku/low but step 3 is opus/high, the orchestrating agent runs at opus/high.
5. **Override respect**: If the user says "think harder" or "quick answer", the neurotoken annotation reflects this -- honor it.

**Dispatch examples:**

*Floor mode (default)*: A code-reviewer agent runs at sonnet/med by default. The neurotoken annotation reads `C=3 S=2 -> opus/high`. The orchestrator escalates: it either dispatches to an opus-class agent or handles the task directly. It never drops below sonnet/med.

*Ceiling mode*: The invoker runs at opus/max. The neurotoken annotation reads `C=0 S=0 -> haiku/low (downgrade OK from opus/max)`. The orchestrator dispatches to a haiku-class researcher agent. If the annotation instead reads `C=1 S=2 -> sonnet/med` with modifier `+deploy` (no downgrade suffix), the orchestrator keeps the task at opus/max -- the safety guard blocked the downgrade.

See `~/.claude/neurotokens.md` for the full policy and adaptive matrix.
