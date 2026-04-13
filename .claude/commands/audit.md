If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /audit <subsystem-name>

Available subsystems: See the "Subsystems" section in CLAUDE.md's
Cycle Workflow Config for the full list.

Example: /audit Auth, Security & Access Control

---

Read CLAUDE.md (especially Common Gotchas, Key Design Decisions, and
the Cycle Workflow Config) before starting. Do not make any changes
to any files during this session.

This session's scope: $ARGUMENTS
Use the Subsystems section of CLAUDE.md's Cycle Workflow Config to
identify the relevant files for this subsystem.

[OPTIONAL: PASTE ANY FOLLOW-ON ITEMS FROM A PRIOR SESSION]

[IF TRIGGERED: PASTE ANY POLICY RESPONSE BLOCKS FROM THE LAST HEALTH
SYNTHESIS — these are MANDATORY scope additions for this cycle]

Perform a layered audit of this subsystem. This is a deeper version
of /targeted-audit that produces a SESSION HANDOFF BLOCK (not a Tier 2
Handoff Block) and does NOT include an implementation plan (that's /plan).

Audit focus areas (check all 12):
1. Bugs and logic errors in currently-reachable code paths
2. Dead code, unused exports, stale TODOs that create confusion
3. Test gaps — code paths with no test coverage that should have it
4. Stale artifacts — outdated comments, wrong doc references
5. Hardcoded values that should be configurable
6. Security concerns specific to this module
7. Documentation drift — CLAUDE.md vs actual implementation
8. Code quality — error handling, edge cases, race conditions
9. Parallel truth sources — same data derived/stored in multiple places
10. Startup assumptions — things that must be true at boot time
11. Silent degradation — failures swallowed, app continues with wrong results
12. Operator-only state — manual setup steps not documented

For each finding:
- State the issue, cite file and function/line
- Severity: Critical / High / Medium / Low
- Confidence: High / Medium / Low
- Would this bug actually fire in production this month? YES/NO
- Effort to fix: S (< 2 hours) / M (half-day to 2 days) / L (3+ days)
- Which audit focus area(s) it falls under

DO NOT flag style preferences, speculative improvements, or "could be
cleaner" refactoring unless the current code is actively wrong.

End with a SESSION HANDOFF BLOCK:

---SESSION HANDOFF BLOCK---
Scope: [subsystem]
Findings: [count] total — [critical/high/medium/low breakdown]
Production bugs (would fire this month): [count]

FINDINGS:
[ID] | [Severity] | [File: area] | [Effort] | [Description]

CROSS-MODULE RISKS:
- [what could break outside this scope and where to verify]
(or "None identified")

INVARIANTS CHECKED:
- [which invariants from the library were verified, pass/fail]

DO NOT TOUCH:
- [high-risk files/functions — explain why]
---END SESSION HANDOFF BLOCK---

After I review the audit, run /plan to produce an implementation plan.
Do not implement anything until then.
