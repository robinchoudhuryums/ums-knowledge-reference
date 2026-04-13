If no IMPLEMENTATION SUMMARY BLOCK exists earlier in this session,
respond with exactly this and stop:

Usage: /reflect — run after /implement (or /regression) in the same
session, or paste an IMPLEMENTATION SUMMARY BLOCK first.

---

Read CLAUDE.md (especially the Invariant Library) before starting.

You are performing a post-cycle reflection on the IMPLEMENTATION
SUMMARY BLOCK above.

Post-cycle assessment with:

1. TWO BINARY QUESTIONS PER ACTION
   For each action completed in the implementation:
   a) Would this bug have actually fired in production this month? YES/NO
   b) Did this fix introduce a new failure mode, documented or not? YES/NO

2. THREE-WAY CLASSIFICATION
   Classify each action as:
   - Production fix: addressed a real bug that would affect users
   - New capability or feature: added something that didn't exist
   - Defensive improvement: hardened against a scenario that hasn't
     happened yet but could

3. NET SCORE TALLY
   Count:
   - Production fixes (YES to question a)
   - New failure modes (YES to question b)
   - Net score = production fixes − new failure modes

   Break down by severity:
   - Critical/High production fixes: [count]
   - Medium/Low production fixes: [count]
   - New failure modes introduced: [count]

4. INVARIANT GROWTH
   Based on this cycle's findings and fixes:
   - Are there new invariants that should be added to the library?
   - Were any existing invariants shown to be unnecessary or wrong?
   - For each new candidate: ID, rule, subsystem, how to verify

5. HONEST IMPACT SUMMARY
   One paragraph: what did this cycle actually accomplish? Be honest
   about whether the changes matter to users or were primarily
   internal quality improvements. Neither is wrong, but be clear
   about which.

6. PRODUCE CYCLE SUMMARY BLOCK:

---CYCLE SUMMARY BLOCK---
Scope: [subsystem or "broad scan"]
Actions completed: [count]
Net score: [production fixes] − [new failure modes] = [net]

CLASSIFICATION:
- Production fixes: [count] ([list IDs])
- New capabilities: [count] ([list IDs])
- Defensive improvements: [count] ([list IDs])

INVARIANT UPDATES:
- New: [list new invariant candidates]
- Retired: [list invalidated invariants]
(or "No changes")

HEALTH DIMENSION IMPACT:
- [Dimension]: likely [improved/unchanged/degraded] — [why]
(for each dimension affected by this cycle's changes)

ONE-LINE IMPACT: [honest single sentence]
---END CYCLE SUMMARY BLOCK---

This CYCLE SUMMARY BLOCK feeds into the next /health-pulse.
