# Operator Follow-ups

Action items that can't be completed from inside a code PR — they require AWS console access, network access to third-party CDNs, or IaC changes outside this repo. Track these in your ops runbook.

## CloudWatch alarm: `batch_orphan_escalation`

**What it's for**: `services/batchScheduler.ts` emits a structured `logger.error` with `alert: "batch_orphan_escalation"` when a Bedrock batch job is submitted to AWS but the subsequent S3 tracking-file write fails through all retries and the orphan-prefix fallback. When this fires, an AWS batch job is running (and billable) but CallAnalyzer can't correlate it to a jobQueue job — the only way to recover is manual reconstruction from the AWS console using the `jobId` + `jobArn` in the log line.

**Why you want an alarm**: the log line is informational on its own; without a CloudWatch metric filter + alarm, operators won't notice until a user complains that their extraction never completed.

### Metric filter

Log group: the one the RAG app writes to (typically `/ums-knowledge-reference/production`).

Filter pattern:
```
{ $.alert = "batch_orphan_escalation" }
```

Metric transformation:
- Metric namespace: `UMS/Knowledge/Batch`
- Metric name: `BatchOrphanEscalations`
- Metric value: `1`
- Default value: `0`
- Unit: `Count`

### Alarm

- Statistic: `Sum`
- Period: `60` seconds
- Evaluation periods: `1`
- Datapoints to alarm: `1`
- Threshold: `>= 1`
- Treat missing data as: `notBreaching`
- Alarm action: SNS topic wired to PagerDuty / on-call email

### Recovery playbook when the alarm fires

1. Grep the application logs for the `batch_orphan_escalation` line closest to the alarm timestamp.
2. Capture `jobId` and `jobArn` from the log.
3. In the AWS console: Bedrock → Batch inference → find the job by ARN.
4. Note the job's output S3 URI and submitted itemIds list.
5. Reconstruct `s3://$S3_BUCKET/batch-inference/active-jobs/${jobId}.json` with the `BatchJob` shape:
   ```json
   {
     "jobId": "...",
     "jobArn": "arn:aws:bedrock:...",
     "status": "Submitted",
     "inputS3Uri": "s3://.../input/batch-xxxxx.jsonl",
     "outputS3Uri": "s3://.../output/batch-xxxxx/",
     "itemIds": ["job-uuid-1", "job-uuid-2", ...],
     "createdAt": "ISO-8601 timestamp"
   }
   ```
6. On the next scheduler cycle, `promoteOrphanedSubmissions()` won't see it (it's already in `active-jobs/`), and `runBatchCycle()` will poll it as normal.

**Note**: the same log tag (`batch_orphan_escalation`) is used in both CA (`assemblyai_tool`) and RAG (`ums-knowledge-reference`). Wire filters per log group separately if you want distinct alarms per product.

## xlsx CVE: upgrade to SheetJS 0.20.3 (community tier)

**What it's for**: `xlsx@0.18.5` — the latest version npm serves — has two unpatched high-severity CVEs:
- [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — Prototype Pollution in sheetJS. Patched in 0.19.3.
- [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) — Regular Expression Denial of Service. Patched in 0.20.2.

SheetJS moved versions ≥0.19 off npm to their own CDN. The 0.20.3 community tier is free and carries both CVE fixes.

### Run from CI or a dev machine with network access to cdn.sheetjs.com

```bash
cd backend
npm uninstall --legacy-peer-deps xlsx
npm install --legacy-peer-deps 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
npm audit --json | jq '.metadata.vulnerabilities'
# expect 'high' to drop to 0; 'moderate' stays at 23 (AWS SDK transitive)
```

### Commit + verify

```bash
git add backend/package.json backend/package-lock.json
git commit -m 'security: upgrade xlsx to SheetJS 0.20.3 (community tier, CVE fix)'
cd backend && npx tsc --noEmit && npx vitest run
# all tests should still pass — services/textExtractor.ts uses only XLSX.read + XLSX.utils.sheet_to_json
# which are stable across the 0.18 → 0.20 line
```

### Why the sandbox couldn't do this in PR #125

The CI sandbox in the Claude session that authored PR #125 couldn't reach `cdn.sheetjs.com` from inside its egress allow-list. All the code work was complete; just the `npm install` step fails with 403. Running the two commands above from the production CI runner or a developer laptop closes the last high-severity vuln.

### Residual moderate vulns (accepted — no fix path yet)

`fast-xml-parser` — AWS SDK's `@aws-sdk/xml-builder@3.972.18` has an EXACT pin on `5.5.8` (not a range). The fix is at 5.7.0. An npm override would risk AWS SDK runtime break. Track upstream [aws-sdk-js-v3 issues](https://github.com/aws/aws-sdk-js-v3/issues) for a release that bumps the pin; until then, 23 moderate vulns remain. `npm audit`'s suggested "fix" is a semver-major downgrade of `@aws-sdk/client-bedrock` to 3.893.0 — that predates the management SDK with `CreateModelInvocationJobCommand` that Phase C relies on, so we can't take it.

## OpenTelemetry exporter-prometheus + sdk-node CVEs

**What it's for**: `@opentelemetry/exporter-prometheus` is flagged for a Prometheus HTTP-exporter crash (process crash via malformed HTTP request). `@opentelemetry/sdk-node` is transitively flagged because it depends on a vulnerable range of `exporter-prometheus`. Both are now on the CI accepted-risk allow list (`.github/workflows/ci.yml`).

**Why accepted**: this app exports traces via OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`), never starts the Prometheus exporter HTTP server, and never imports `exporter-prometheus` directly. The exploit surface is zero in this deployment. The only fix is a breaking jump to `@opentelemetry/sdk-node 0.217+`, which would risk the existing custom-span wire-up in `routes/query.ts` and `services/ingestion.ts`.

### When upstream releases a non-breaking patch

Watch for a `@opentelemetry/sdk-node` release that pulls a patched `exporter-prometheus` without a major version bump. Track [opentelemetry-js issues](https://github.com/open-telemetry/opentelemetry-js/issues) for `exporter-prometheus` patches. When available:

```bash
cd backend
npm update @opentelemetry/sdk-node @opentelemetry/exporter-prometheus
npm audit --audit-level=high   # should report 0 high
# Remove the two packages from the ACCEPTED_PKGS line in .github/workflows/ci.yml
```

### Or — if you want to fully drop the Prometheus exporter dependency

If we don't intend to use Prometheus at all (current state — we use OTLP), it would be cleaner to switch from `@opentelemetry/sdk-node` (which carries every exporter) to a narrower SDK assembly that pulls only the OTLP HTTP exporter. That's a backend `tracing.ts` refactor; not blocking, but cleaner than the accepted-risk approach long-term.
