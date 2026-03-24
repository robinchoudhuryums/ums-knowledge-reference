# UMS Knowledge Base Reference Tool

A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for **Universal Medical Supply (UMS)**. Employees upload documents and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude via AWS Bedrock, and returns cited answers.

## Features

- **Document ingestion** — Upload PDFs, DOCX, XLSX, CSV, and TXT files. Text extraction uses pdf-parse, AWS Textract OCR, and Claude vision (for images/diagrams in PDFs).
- **RAG chat** — Ask questions and get cited answers grounded in your documents. Streaming SSE responses with markdown rendering.
- **Conversation memory** — Follow-up questions are reformulated into standalone queries for better retrieval. Older turns are summarized automatically.
- **Hybrid search** — Cosine similarity + IDF-enhanced BM25 keyword scoring with post-retrieval re-ranking.
- **Structured extraction** — Extract structured data from documents using configurable templates (PPD, CMN, Prior Auth, General).
- **Clinical note extraction** — Upload physician notes to extract ICD-10 codes, test results, medical necessity language, and map them to CMN form fields.
- **Form review** — CMN form type auto-detection with required-field rules, blank detection, and confidence-based annotations on PDFs.
- **Interactive PDF annotations** — Client-side PDF viewer with drag-to-move annotations, undo/redo, and highlight drawing.
- **Document source monitoring** — Track external URLs (LCDs, CMS policies) for changes and auto-reingest when content updates.
- **HIPAA compliance** — PHI redaction on logs, JWT auth with account lockout, HTTPS enforcement with HSTS, password history tracking, audit logging.
- **Admin dashboards** — RAG observability tracing, query quality metrics, FAQ analytics, query log export (CSV).

## Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | React + TypeScript + Vite |
| **Backend** | Node.js + Express + TypeScript |
| **LLM (RAG)** | Claude Haiku 4.5 via AWS Bedrock |
| **LLM (Extraction)** | Claude Sonnet 4.6 via AWS Bedrock |
| **Embeddings** | Amazon Titan Embed V2 |
| **OCR** | AWS Textract |
| **Storage** | Amazon S3 (documents, vectors, metadata, audit logs) |
| **Deployment** | Docker (single container), Render.com |

## Quick Start

### Prerequisites
- Node.js 18+
- AWS account with S3, Bedrock, and Textract access
- Docker (optional, for production builds)

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

### Docker

```bash
docker build -t ums-knowledge .
docker run -p 3001:3001 --env-file backend/.env ums-knowledge
```

## Development

```bash
# Type-check
cd backend && npx tsc --noEmit

# Run tests (38 tests: vector store + PHI redaction)
cd backend && npm test

# Build frontend for production
cd frontend && npm run build
```

## AWS IAM Permissions

The IAM role/user needs:
- **Bedrock**: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`
- **Textract**: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
- **S3**: Standard read/write/delete on the configured bucket

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/query` | RAG query (non-streaming) |
| POST | `/api/query/stream` | RAG query (streaming SSE) |
| POST | `/api/documents/upload` | Upload document |
| GET | `/api/documents` | List documents |
| POST | `/api/documents/clinical-extract` | Extract clinical data from notes |
| POST | `/api/extraction/extract` | Structured extraction with template |
| POST | `/api/feedback` | Submit response feedback |
| GET | `/api/query-log` | View query logs (admin) |
| GET | `/api/usage` | Usage stats |
| CRUD | `/api/sources/*` | Document source monitoring (admin) |

## License

Proprietary — Universal Medical Supply internal use.
