Five-phase read-only architectural analysis. Do not make any changes
to files during this session.

Read CLAUDE.md and README before starting.

═══════════════════════════════════════════
PHASE 1 — ENTRY POINTS & PROJECT STRUCTURE
═══════════════════════════════════════════

Identify all entry points:
- Server/application startup files
- Client/frontend entry points
- CLI scripts and utilities
- Background job/scheduler entry points
- Migration/setup scripts

Map the project directory structure with one-line descriptions.

═══════════════════════════════════════════
PHASE 2 — MODULE IDENTIFICATION
═══════════════════════════════════════════

For each major module/service:
- What it does (one sentence)
- What it depends on (imports)
- What depends on it (consumers)
- Startup assumptions (what must be true when this module loads)

═══════════════════════════════════════════
PHASE 3 — DATA FLOW TRACING
═══════════════════════════════════════════

Trace 3 critical data flows end-to-end:
1. The primary user-facing operation (e.g., a query or request)
2. A data ingestion/write path
3. A background/scheduled operation

For each flow: entry point → each module touched → data transformations
→ storage → response/output. Note where errors are handled (or not).

═══════════════════════════════════════════
PHASE 4 — DEPENDENCY MAP
═══════════════════════════════════════════

Produce:
- External service dependencies (APIs, databases, cloud services)
- Internal high-fan-out modules (most imported)
- Circular or near-circular dependency chains
- Singleton/global state locations

═══════════════════════════════════════════
PHASE 5 — VALIDATION
═══════════════════════════════════════════

Cross-reference your map against:
- CLAUDE.md's architecture description — any discrepancies?
- The Subsystems section of Cycle Workflow Config — do your module
  boundaries match the defined subsystems?
- README — does the stated architecture match reality?

Report any discrepancies found.

OUTPUT:
Produce a concise systems map suitable for adding to CLAUDE.md's
Systems Map section (if one doesn't exist) or validating the existing one.
