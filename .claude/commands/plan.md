If no SESSION HANDOFF BLOCK exists earlier in this session, respond
with exactly this and stop:

Usage: /plan — run after /audit in the same session, or paste a
SESSION HANDOFF BLOCK first.

---

Read CLAUDE.md (especially Common Gotchas) before starting.

You are creating an implementation plan from the SESSION HANDOFF BLOCK above.

Takes the SESSION HANDOFF BLOCK and produces an IMPLEMENTATION HANDOFF
BLOCK with:

1. PRIORITIZED ACTIONS
   For each finding in the handoff block, create a concrete action:
   - Action ID (A1, A2, A3...)
   - What specifically to do (concrete, not vague)
   - Which finding(s) it addresses
   - Effort: S / M / L
   - Cross-module risk: Low / Medium / High / Very High
   - Prerequisites (other actions that must complete first)

   Organize into:
   - Do immediately — production bugs, security issues, blocking problems
   - Do this week — high-value, well-scoped, low cross-module risk
   - Defer — needs more context, high risk, or dependencies outside scope

2. BATCH SPLITTING (if >15 findings)
   Split into implementation batches of 8-12 actions each, ordered by
   dependency and risk. Each batch should be completable in one session.

3. ARCHITECTURAL DECISIONS
   For any finding where the fix approach is ambiguous:
   - State the options (at least 2)
   - List tradeoffs for each
   - Recommend one with reasoning

4. DOCUMENTATION UPDATE CHECKLIST
   List every documentation change needed if all actions are implemented:
   - CLAUDE.md updates (Common Gotchas, Key Design Decisions, etc.)
   - README updates
   - Inline comment updates
   - Test documentation

5. IMPLEMENTATION ORDERING
   Final ordered list with rationale for the sequence, considering:
   - Dependencies between actions
   - Risk (do risky changes when the codebase is in a known-good state)
   - Quick wins first (builds momentum, catches unexpected issues early)

---IMPLEMENTATION HANDOFF BLOCK---
Scope: [subsystem]
Total actions: [count]
Batches: [count if >1]

BATCH [N] (implement in this order):
[ID] | [Priority] | [File: area] | [Effort] | [Risk] | [Description]

ARCHITECTURAL DECISIONS:
[Decision ID] — [options and recommendation]

DO NOT TOUCH:
[carried forward from SESSION HANDOFF BLOCK]

DOCUMENTATION UPDATES:
- [list of doc changes needed]
---END IMPLEMENTATION HANDOFF BLOCK---

After I review the plan, run /implement to execute it.
Do not implement anything until then.
