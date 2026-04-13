Quick directional health snapshot. Do not make any changes to files.

Read CLAUDE.md's Cycle Workflow Config (Health Dimensions, Subsystems,
Invariant Library, Policy Configuration) before starting.

═══════════════════════════════════════════
AXIS A — VERTICAL SUBSYSTEM HEALTH
═══════════════════════════════════════════

For each health dimension in the Cycle Workflow Config:
- Score: [N]/10
- Confidence: High / Medium / Low
- Trend: Improving / Stable / Degrading (vs. last known score if available)
- Key signal: [one sentence — what most influenced this score]

If any CYCLE SUMMARY BLOCKs are pasted above, use their HEALTH
DIMENSION IMPACT sections to inform trend direction.

═══════════════════════════════════════════
AXIS B — BUG-SHAPE POSTURE SCAN
═══════════════════════════════════════════

Lightweight scan across 5 bug categories:
1. Silent data corruption — wrong results without errors
2. Security boundary violations — auth/access control gaps
3. Resource leaks — connections, memory, file handles not released
4. Race conditions — concurrent access without synchronization
5. Error swallowing — catch blocks that hide failures

For each category:
- Risk level: Low / Medium / High
- Evidence: [one specific example or "No evidence found"]

═══════════════════════════════════════════
CLOSING
═══════════════════════════════════════════

POLICY CHECK:
- Any dimension at or below the policy threshold? [list or "None"]
- Any dimension below threshold for 2+ consecutive cycles? [list or "None"]
  (These trigger MANDATORY inclusion in the next audit cycle)

TOP 3 RISKS (what's most likely to cause problems next):
1. [risk] — [which subsystem] — [suggested investigation]
2. [risk] — [which subsystem] — [suggested investigation]
3. [risk] — [which subsystem] — [suggested investigation]

RECOMMENDED NEXT ACTION:
[One sentence — what should the next cycle focus on and why]
