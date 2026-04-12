### Neurotoken-Guided Dispatch

Check the `[neurotoken]` context line in system-reminder for the recommended model/effort tier.
Use the two-axis score (Complexity × Stakes) to select agents and calibrate response depth.

**Tier → Dispatch mapping:**
- **haiku/low–med** (C≤1, S≤1): Dispatch to lightweight agents — researcher, code-simplifier, health-monitor
- **sonnet/med–high** (C≤2, S≤2): Standard agents — code-reviewer, test-generator, company-researcher
- **opus/med** (C≥3 or S≥3): Handle directly or dispatch to opus-class agents
- **opus/high–max** (C≥2, S≥2 with modifiers): Handle directly. Full cross-system reasoning. No delegation for opus/max.

**Rules:**
1. **Floor rule**: Agent frontmatter model/effort is the minimum. Neurotokens escalates, never downgrades.
2. **Subagent handoff**: Include the `[neurotoken]` recommendation in the subagent task description — subagents don't inherit parent hook context.
3. **Multi-step tasks**: Score the overall task at the highest component tier. If step 1 is haiku/low but step 3 is opus/high, the orchestrating agent runs at opus/high.
4. **Override respect**: If the user says "think harder" or "quick answer", the neurotoken annotation reflects this — honor it.

See `~/.claude/neurotokens.md` for the full policy and adaptive matrix.
