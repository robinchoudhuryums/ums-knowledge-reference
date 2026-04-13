If no IMPLEMENTATION SUMMARY BLOCK exists earlier in this session,
respond with exactly this and stop:

Usage: /regression — run after /implement in the same session, or
paste an IMPLEMENTATION SUMMARY BLOCK first.

---

Read CLAUDE.md (especially Common Gotchas and the Invariant Library)
before starting.

You are performing regression analysis on the IMPLEMENTATION SUMMARY
BLOCK above.

Takes an IMPLEMENTATION SUMMARY BLOCK and:

1. IDENTIFY AFFECTED MODULES
   For each file modified in the implementation:
   - List every other file that imports from or depends on the changed file
   - For each dependent: what specific exports/behaviors does it rely on?
   - Could the change have altered those behaviors?

2. VALIDATE EACH RISK
   For each regression risk identified in the implementation summary:
   - Read the affected code
   - Determine: materialized (actually broken) or negated (safe)
   - If materialized: describe the breakage and suggest a fix

   For each cross-module dependent identified in step 1:
   - Quick-read the dependent code
   - Determine: affected or unaffected by the changes
   - If affected: is the effect correct (intended improvement) or
     incorrect (regression)?

3. INVARIANT CROSS-REFERENCE
   For each invariant in the project's invariant library (from CLAUDE.md):
   - Could any change in this implementation have violated it?
   - If yes: verify by code read — is it actually violated?

4. PRODUCE FOLLOW-ON AUDIT ITEMS

---FOLLOW-ON AUDIT ITEMS---
REGRESSIONS FOUND: [count, or "None"]
[ID] | [File: area] | [What broke] | [Suggested fix]

INVARIANT VIOLATIONS: [count, or "None"]
[INV-XX] | [What happened] | [How to restore]

DEPENDENCIES TO MONITOR:
- [modules that weren't broken but are at elevated risk]
(or "None")

CLEAN: [YES/NO — is the implementation safe to ship as-is?]
---END FOLLOW-ON AUDIT ITEMS---

Suggest running /reflect next.
