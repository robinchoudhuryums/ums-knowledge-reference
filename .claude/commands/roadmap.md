Four-tier strategic planning grounded in audit findings.
Do not make any changes to files during this session.

Read CLAUDE.md (especially Recent Changes, Key Design Decisions, and
any existing roadmap) and README before starting.

If CYCLE SUMMARY BLOCKs or audit findings are pasted above, use them
as primary input. Otherwise, perform a quick scan of the codebase to
identify improvement opportunities.

═══════════════════════════════════════════
TIER 1 — IMMEDIATE (days to weeks)
═══════════════════════════════════════════

Grounded in audit findings and known issues:
- Production bugs and security fixes
- Test coverage gaps for critical paths
- Documentation that's actively misleading
- Quick wins with high user impact

For each item: [description] | [effort: S/M/L] | [source: audit finding,
user report, code observation]

═══════════════════════════════════════════
TIER 2 — NEAR-TERM (weeks to months)
═══════════════════════════════════════════

Structural improvements building on existing architecture:
- Refactoring that unlocks future work
- Performance improvements for known bottlenecks
- Scaling preparation (what breaks at 2x, 10x load?)
- Developer experience improvements

For each item: [description] | [effort: S/M/L] | [why now — what
does this unblock?]

═══════════════════════════════════════════
TIER 3 — MEDIUM-TERM (months+)
═══════════════════════════════════════════

Capability expansions that extend what the system can do:
- New features that users have asked for or would expect
- Integrations with external systems
- Operational maturity (monitoring, alerting, disaster recovery)

For each item: [description] | [effort: M/L] | [depends on: which
Tier 1/2 items are prerequisites]

═══════════════════════════════════════════
TIER 4 — EXPLORATORY
═══════════════════════════════════════════

Not constrained by current architecture:
- What would you build differently if starting over?
- What capabilities would transform the product?
- What technical debt would you pay off given unlimited time?

For each item: [description] | [why it matters] | [what would need
to change to make this feasible]

═══════════════════════════════════════════
PRIORITIZATION
═══════════════════════════════════════════

Recommended execution order across all tiers, considering:
- Dependencies between items
- Risk reduction (what prevents the worst outcomes?)
- User impact (what makes the biggest difference to users?)
- Effort-to-impact ratio

Top 5 items to work on next, with rationale.
