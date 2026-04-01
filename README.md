# UMS Knowledge Base Reference Tool

A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for **Universal Medical Supply (UMS)**. Employees upload documents and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude via AWS Bedrock, and returns cited answers.

## Features

### Knowledge Base & RAG
- **Document ingestion** — Upload PDFs, DOCX, XLSX, CSV, TXT, and HTML files. Text extraction uses pdf-parse with conditional Textract OCR (skipped for text-native PDFs), and Claude vision (for images/diagrams). Mutex-protected index updates, chunk rollback on failure, file extension whitelist.
- **RAG chat** — Ask questions and get cited answers grounded in your documents. Streaming SSE responses with markdown rendering. Auto-enriched with structured HCPCS/ICD-10/coverage data when relevant. Prompt injection detection with XML context framing.
- **Conversation memory** — Follow-up questions are reformulated into standalone queries. Older turns are summarized automatically.
- **Hybrid search** — Cosine similarity + dynamically-normalized BM25 keyword scoring (adapts to corpus) with medical-term-aware tokenizer and post-retrieval re-ranking. Embedding dimension validation prevents silent failures on model changes.

### DME Reference Data (integrated into RAG)
- **HCPCS code lookup** — 332 real DME codes across 25 categories (power wheelchairs, oxygen, CPAP supplies, catheters, incontinence, ventilators, bed/wheelchair accessories, respiratory supplies).
- **ICD-10 to HCPCS crosswalk** — 66 diagnosis codes, 116+ mappings. Forward/reverse lookup with documentation requirements.
- **LCD coverage checklists** — 8 real CMS LCDs with per-item documentation requirements and validation.
- **Structured reference enrichment** — RAG queries automatically detect HCPCS/ICD-10 codes and inject structured data alongside document context.

### Forms & Workflow Tools
- **PPD Questionnaire** — 45-question phone interview tool (EN/ES) for Power Mobility Device orders with:
  - PMD recommendation engine (weight class, neuro eligibility, solid seat logic, substitution rules)
  - Product catalog with images, brochures, dimensions, colors, lead times
  - Auto-generated Seating Evaluation (maps all answers to 10-section clinical form)
  - Submission queue for Pre-Appointment Kit team handoff
  - Interactive pain body map, SVG progress ring, animated sections
- **PMD Account Creation** — Sales lead intake form for power mobility patients (demographics, insurance, clinical, scheduling).
- **PAP Account Creation** — CPAP/BiPAP sales lead intake with conditional formatting (sleep study status, equipment age).
- **Insurance card OCR** — Upload card photo → Textract + Claude extracts insurance name, member ID, group #, plan type. Auto-fills form fields and flags mismatches.

### Document Management
- **Structured extraction** — Extract data using templates (PPD Seating Evaluation, CMN, Prior Auth, General).
- **Clinical note extraction** — Upload physician notes → extract ICD-10 codes, test results, medical necessity, map to CMN fields.
- **Document source monitoring** — Track external URLs (CMS LCDs, policies) for changes and auto-reingest. 8 LCD sources pre-configured.
- **Form review** — CMN form type auto-detection with required-field rules and confidence-based PDF annotations.

### HIPAA Compliance
- PHI redaction on all logs (SSN, DOB, MRN, phone, email, addresses, Medicare/Medicaid IDs, natural language DOB patterns)
- JWT auth with httpOnly cookies, 30-minute expiry, 15-minute idle timeout with interaction blocking
- Account lockout (5 attempts, 15-minute cooldown) enforced in both login and API middleware, password history (last 5)
- Audit logging with SHA-256 hash chaining (mutex-protected for concurrent writes, auto-PHI-redacted details)
- Automated data retention with hard-coded HIPAA minimum floors (audit ≥ 6yr, configurable above that)
- HTTPS enforcement with HSTS, CSRF protection, SSRF prevention
- Prompt injection detection (12 patterns) with XML context framing
- JWT_SECRET strength enforcement in production (fail-fast on missing/weak secret)
- Client-side PHI detection warning before query submission
- HTML escaping on all email template user data (XSS prevention)
- CRLF sanitization on email subjects (header injection prevention)
- Rate limiting on all expensive endpoints (queries, extraction, form submissions, OCR)
- CORS origin validation (prevents wildcard with credentials)
- Cryptographically random JWT token IDs (`crypto.randomUUID()`)
- Non-root Docker container
- Dependabot for automated dependency security updates

### Admin & Analytics
- RAG observability dashboard, query quality metrics, FAQ analytics
- Query log viewer with CSV export, audit log export with chain verification
- User management (CRUD, role assignment, password reset with session revocation)
- Server metrics endpoint (`/api/metrics`) with per-route latency percentiles, error rates, memory usage
- Email sending via Gmail SMTP for form submissions with address validation and rate limiting

## Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | React + TypeScript + Vite |
| **Backend** | Node.js + Express + TypeScript |
| **LLM (RAG)** | Claude Haiku 4.5 via AWS Bedrock |
| **LLM (Extraction)** | Claude Sonnet 4.6 via AWS Bedrock |
| **Embeddings** | Amazon Titan Embed V2 |
| **OCR** | AWS Textract |
| **Database** | PostgreSQL 17 on AWS RDS (pgvector for embeddings) |
| **Storage** | Amazon S3 (raw document files), PostgreSQL (metadata, vectors, audit) |
| **Icons** | Heroicons (UI) + Lucide React (medical: Brain, Stethoscope) |
| **Styling** | Tailwind CSS v4 + 60+ CSS variables (light/dark themes, semantic status/confidence colors) |
| **Deployment** | Docker on EC2 behind ALB, auto-deploy via GitHub Actions |

## Quick Start

### Prerequisites
- Node.js 20+ (pinned via `.nvmrc` — run `nvm use` to auto-select)
- AWS account with S3, Bedrock, Textract, and RDS access
- PostgreSQL 15+ with pgvector extension (AWS RDS recommended)
- Docker (for production builds)

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd ums-knowledge-reference

# Backend
cd backend
cp .env.example .env    # Edit with your AWS credentials and config
npm install
npm run dev             # Starts on :3001

# Frontend (new terminal)
cd frontend
npm install
npm run dev             # Starts on :5173
```

### Environment Variables

See `backend/.env.example` for all configuration options:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — AWS credentials
- `S3_BUCKET` — S3 bucket for all storage
- `BEDROCK_GENERATION_MODEL` — Claude model for RAG (default: Haiku 4.5)
- `BEDROCK_EXTRACTION_MODEL` — Claude model for extraction (default: Sonnet 4.6)
- `JWT_SECRET` — **Must be changed from default in production** (server will refuse to start otherwise)
- `JWT_EXPIRY` — Token expiry (default: 30m, HIPAA-recommended short sessions)
- `SMTP_USER`, `SMTP_PASS` — Gmail app password for form email sending (optional)
- `PPD_BCC_EMAIL` — BCC address for PPD/form emails (optional)
- `RETENTION_AUDIT_DAYS` — Audit log retention (default: 2555, ~7 years)
- `RETENTION_QUERY_LOG_DAYS` — Query log retention (default: 365)
- `DATABASE_URL` — PostgreSQL connection string (enables RDS storage, falls back to S3 JSON when not set)

### Docker

```bash
docker build -t ums-knowledge .
docker run -p 3001:3001 --env-file backend/.env ums-knowledge
```

### Production Deployment (EC2)

The app auto-deploys to EC2 via GitHub Actions when code is pushed to `main`:
1. CI runs (lint, type-check, 823 tests)
2. SSHes into EC2 → `git pull` → `docker build` → restart container
3. Health check verification at `/api/health`

Manual deploy:
```bash
cd ~/ums-knowledge-reference && git pull
docker build -t ums-knowledge .
docker stop ums-knowledge && docker rm ums-knowledge
docker run -d --name ums-knowledge --restart unless-stopped --env-file ~/ums-knowledge.env -p 3001:3001 ums-knowledge
```

## Development

```bash
# Type-check
cd backend && npx tsc --noEmit

# Run tests (823 tests across 53 test files)
cd backend && npm test

# Lint
cd backend && npm run lint

# Build frontend for production
cd frontend && npm run build

# Reset admin password (on EC2, loads production env vars)
cd ~/ums-knowledge-reference/backend && env $(cat ~/ums-knowledge.env | grep -v '^#' | xargs) npx tsx src/scripts/reset-admin.ts
```

## AWS IAM Permissions

The IAM role/user needs:
- **Bedrock**: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`
- **Textract**: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
- **S3**: Standard read/write/delete on the configured bucket

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/query` | RAG query (non-streaming, auto-enriched with structured data) |
| POST | `/api/query/stream` | RAG query (streaming SSE) |
| POST | `/api/documents/upload` | Upload document |
| GET | `/api/documents` | List documents |
| POST | `/api/documents/clinical-extract` | Extract clinical data from notes |
| POST | `/api/extraction/extract` | Structured extraction with template |
| GET | `/api/hcpcs/search?q=` | Search HCPCS codes |
| GET | `/api/icd10/for-diagnosis/:code` | ICD-10 → HCPCS crosswalk |
| GET | `/api/coverage/checklist/:code` | LCD coverage checklist |
| GET | `/api/ppd/questions` | PPD questionnaire (45 questions EN/ES) |
| POST | `/api/ppd/recommend` | PMD recommendations from PPD responses |
| POST | `/api/ppd/seating-eval` | Auto-fill Seating Evaluation form |
| POST | `/api/ppd/submit` | Submit PPD to review queue |
| GET | `/api/account-creation/questions` | PMD Account Creation form |
| POST | `/api/account-creation/read-insurance-card` | OCR insurance card image |
| GET | `/api/pap-account/questions` | PAP Account Creation form |
| POST | `/api/feedback` | Submit response feedback |
| CRUD | `/api/sources/*` | Document source monitoring (admin) |
| CRUD | `/api/users/*` | User management (admin) |
| GET | `/api/query-log/*` | Query logs, audit logs, observability (admin) |
| GET | `/api/health` | Health check (S3, database, vector store) |
| GET | `/api/metrics` | Server metrics — latency percentiles, error rates (admin) |

## License

Proprietary — Universal Medical Supply internal use.
