# Security policy

## Reporting a vulnerability

Report security issues privately to [jeff@87n1.com](mailto:jeff@87n1.com). Please do not open public issues for vulnerabilities.

Expected response within 7 days. If the issue is confirmed, expect a fix or mitigation within 30 days, depending on severity.

## Scope

Neurotoken is a zero-dependency prompt scoring engine. It reads prompt text and returns a model and thinking-budget tier. It runs as a Claude Code hook, which means it processes untrusted input on every prompt, with no network calls and no filesystem writes. The realistic concerns follow from that shape:

- **Regular-expression denial of service.** Scoring is signal matching over arbitrary prompt text. If you can construct an input that makes a pattern in `src/lib/` run in superlinear time, that stalls the hook and therefore the session. This is the most likely real vulnerability in this project and the one worth looking for first.
- **Tier downgrade through crafted input.** The scorer decides how much reasoning a prompt receives, and a prompt that talks about its own scoring is still just a prompt. If you can reliably force a lower tier than the content warrants, report it. Safety modifiers are meant to be one-directional and there are tests asserting that; a bypass is in scope.
- **Override injection.** `detectUserOverride()` reads phrases out of the prompt to raise the tier. Report any way to trigger an override from text the user did not intend as one.

Out of scope:

- Claude Code itself, and the models it routes to. Report those to Anthropic.
- Disagreeing with a score. A prompt landing in a tier you would not have chosen is a calibration question, not a vulnerability. Open a normal issue.
- Anything requiring the user to run the scorer against input they already control and trust.

## What to include

The input that triggers it, the observed behaviour, and what you expected instead. For a timing issue, include the input length and the wall-clock time you measured.
