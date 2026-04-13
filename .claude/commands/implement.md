If no IMPLEMENTATION HANDOFF BLOCK exists earlier in this session,
respond with exactly this and stop:

Usage: /implement — run after /plan in the same session, or paste an
IMPLEMENTATION HANDOFF BLOCK first.

---

Read CLAUDE.md (especially Common Gotchas) before starting.

You are executing the IMPLEMENTATION HANDOFF BLOCK above.

Takes an IMPLEMENTATION HANDOFF BLOCK and executes it with:

PRE-IMPLEMENTATION:
- For any action rated High or Very High cross-module risk: read the
  affected files first and confirm the approach before changing anything
- Check Common Gotchas before each action to avoid re-introducing known issues
- Verify the test suite passes before starting (baseline)

IMPLEMENTATION RULES:
- Implement ONLY the actions in the handoff block, in order
- Do not fix, refactor, or improve anything outside scope — note for follow-on
- Stop on unexpected complexity and describe before continuing
- Stop if touching DO NOT TOUCH files
- After each action, briefly note: what changed, files touched, anything unexpected

After all actions complete:

1. RUN TESTS
Run the test suite (use the test command from CLAUDE.md's Cycle Workflow
Config, or `npm test` if not specified). Classify failures:
- Category A: outdated assertions needing update (fix now)
- Category B: tests with local redefinitions (rewrite to import production values)
- Category C: pre-existing failures (fix if scoped, otherwise note)

2. REGRESSION CHECK
For each file modified:
- Could this change break any caller or consumer?
- Did you change any interface, return type, or default value?
- Cross-reference CROSS-MODULE RISKS from the handoff block

3. DOCUMENTATION UPDATES
Implement the documentation changes listed in the handoff block.

4. SUMMARY — produce IMPLEMENTATION SUMMARY BLOCK:

---IMPLEMENTATION SUMMARY BLOCK---
Scope: [subsystem]
Actions completed: [list IDs]
Actions not completed: [list with reason, or "All completed"]
Files modified: [list]

CHANGES:
[Action ID] | [File(s)] | [What changed] | [Findings addressed]

TEST RESULTS: [passed/failed — details if failed]
REGRESSION RISKS: [risks or "None"]

FOLLOW-ON ITEMS:
- [anything noticed but not fixed, out of scope]
(or "None")
---END IMPLEMENTATION SUMMARY BLOCK---

Suggest running /regression next, then /reflect.
