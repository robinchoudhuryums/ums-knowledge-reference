# UMS Knowledge Base Reference Tool

## Project Overview
A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for Universal Medical Supply (UMS). Employees upload documents (PDFs, DOCX, XLSX, CSV, TXT) and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude Haiku 4.5 via AWS Bedrock, and returns cited answers.

## Architecture

### Backend (`backend/`)
- **Runtime**: Node.js + Express + TypeScript
- **Entry**: `backend/src/index.ts`
- **Key services**:
  - `ingestion.ts` — Full pipeline: upload to S3 → extract text → vision describe images → chunk → embed → store in vector store
  - `textExtractor.ts` — Extracts text from PDFs (pdf-parse + Textract OCR in parallel), DOCX, XLSX, CSV
  - `visionExtractor.ts` — Sends PDFs to Haiku 4.5 via Bedrock Converse API to describe images/diagrams
  - `ocr.ts` — AWS Textract OCR (sync for images, async for multi-page PDFs)
  - `chunker.ts` — Splits text into overlapping chunks with section header detection
  - `embeddings.ts` — Amazon Titan Embed V2 via Bedrock
  - `vectorStore.ts` — JSON-based vector store on S3 with cosine similarity search + keyword boosting
  - `s3Storage.ts` — S3 operations for documents, vectors, metadata
  - `audit.ts` — HIPAA audit logging to S3
  - `usage.ts` — Per-user daily query limits
  - `queryLog.ts` — Query analytics with CSV export
  - `faqAnalytics.ts` — FAQ pattern detection from query logs
- **Routes**: `query.ts` (RAG query + streaming SSE), `documents.ts`, `feedback.ts`, `queryLog.ts`, `usage.ts`
- **Auth**: JWT-based with role support (admin/user), middleware in `middleware/auth.ts`

### Frontend (`frontend/`)
- **Framework**: React + TypeScript + Vite
- **Entry**: `frontend/src/App.tsx`
- **Components**: `ChatInterface.tsx` (main chat), `DocumentManager.tsx`, `DocumentSearch.tsx`, `FaqDashboard.tsx`, `FeedbackForm.tsx`, `LoginForm.tsx`, `OcrTool.tsx`, `PopoutButton.tsx`, `QueryLogViewer.tsx`, `SourceViewer.tsx`
- **Styling**: Inline styles + `index.css` (healthcare blue palette with hexagonal/molecular background pattern)
- **API client**: `frontend/src/api.ts`

### AWS Services Used
- **S3**: Document storage, vector store, metadata, audit logs
- **Bedrock**: Claude Haiku 4.5 (generation + vision), Titan Embed V2 (embeddings)
- **Textract**: OCR for scanned PDFs and images

### Deployment
- Single Docker container via `Dockerfile` (serves both backend API and frontend static build)
- Configured for Render.com via `render.yaml`
- Environment variables in `.env` (see `.env.example`)

## Development Commands
```bash
# Backend
cd backend && npm install && npm run dev    # Dev server with tsx watch
cd backend && npx tsc --noEmit              # Type-check only

# Frontend
cd frontend && npm install && npm run dev   # Vite dev server
cd frontend && npm run build                # Production build

# Full build (Docker)
docker build -t ums-knowledge .
```

## Key Configuration
- `backend/src/config/aws.ts` — AWS clients, S3 bucket, Bedrock model IDs
- Generation model: `us.anthropic.claude-haiku-4-5-20251001-v1:0` (cross-region inference profile)
- Embedding model: `amazon.titan-embed-text-v2:0`
- System prompt: `backend/src/routes/query.ts` (line ~15)
- Temperature: `0.15`, max tokens: `4096`, default topK: `6` chunks

## Tuning Knobs for Response Quality
- **System prompt** (`query.ts:15`): Controls tone, conciseness, citation style
- **Temperature** (`query.ts:151,243`): Currently 0.15 (conservative). Higher = more varied
- **Max tokens** (`query.ts:148,240`): Currently 4096. Lower = forces shorter answers
- **topK** (`query.ts:122,212`): Default 6 chunks. Fewer = more focused, more = comprehensive
- **Chunk size/overlap** (`chunker.ts`): Affects retrieval granularity

## Recent Changes (reverse chronological)
- Added conciseness guideline to system prompt for balanced response length
- Added vision-based image description for PDFs (Bedrock Converse API + Haiku 4.5)
- PDF ingestion runs Textract OCR alongside pdf-parse to capture text in images
- Boosted hexagonal background pattern visibility (doubled opacity, increased stroke/dot size)
- Fixed Bedrock cross-region inference profile for Haiku 4.5
- Added auto-logout on 401 responses
- Healthcare blue UI palette with molecular pattern
- Streaming SSE responses, markdown rendering, document search
- FAQ analytics, query logging with CSV export, OCR tool
- Confidence scoring, feedback/flagging, usage tracking

## IAM Permissions Needed
The Bedrock IAM policy needs these actions:
- `bedrock:InvokeModel` (generation, embeddings, vision via Converse)
- `bedrock:InvokeModelWithResponseStream` (streaming responses)
- Textract: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`
- S3: standard read/write/delete on the configured bucket
