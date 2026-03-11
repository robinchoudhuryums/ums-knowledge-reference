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
cd backend && npm test                      # Run unit tests (vitest)

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
- **Intake data auto-fill**: New "Intake / Clinical" tab with form fields for patient demographics, physician info, supplier details, HCPCS, diagnosis, and insurance. Generates CMN/prior-auth field mappings from entered intake data for form pre-population.
- **AI-assisted clinical note extraction**: Upload physician notes → Claude Sonnet extracts ICD-10 codes, test results (ABG, SpO2, PFT), medical necessity language, functional limitations, equipment recommendations, and HCPCS codes. Maps extracted data to CMN form fields. Backend: `clinicalNoteExtractor.ts`, route: `POST /api/documents/clinical-extract`.
- **Interactive PDF annotation editor**: Client-side PDF viewer (PDF.js) with SVG overlay for interactive annotations. Drag-to-move, click-to-remove, undo/redo (Ctrl+Z/Y), manual highlight drawing with 4 color choices. Code-split via React.lazy(). Component: `AnnotatedPdfViewer.tsx`.
- **Structured document extraction**: Extraction templates (PPD, CMN, Prior Auth, General) with Claude Sonnet via Bedrock. Upload any document → get structured JSON data matching template fields. Route: `POST /api/extraction/extract`.
- **RAG observability tracing**: Per-query trace logging (`ragTrace.ts`) capturing retrieval scores, response times, and confidence. Observability dashboard with daily stats, retrieval/generation failure drill-down.
- **Quality metrics dashboard**: Tracks query confidence distribution, flagged responses, and unanswered questions over time.
- **CMS fee schedule fetcher**: Auto-fetches and ingests CMS DME fee schedules (`feeScheduleFetcher.ts`) with configurable refresh interval. Admin trigger: `POST /api/documents/fee-schedule/fetch`.
- **Document reindexer**: Change detection service (`reindexer.ts`) that checks for modified documents and re-ingests them. Admin trigger: `POST /api/documents/reindex`.
- **Document collections and tagging**: Organize documents into collections, add/remove tags, filter queries by collection.
- **Form review enhancements**: CMN form type auto-detection (CMS-484, CMS-10126, CMS-10125, prior auth) with required-field rules (`config/formRules.ts`), improved blank detection (underscores, placeholders, unchecked checkboxes), confidence threshold categories (high/low at 60%), template caching via SHA-256 hash on S3 (`form-analysis-cache/`), batch review endpoint (up to 10 files), in-browser PDF preview, confidence-based coloring on annotated PDFs (red=missing, amber=low confidence, orange=required)
- **IDF-enhanced BM25 hybrid search**: Added proper IDF weighting to BM25 scoring with corpus-wide term frequency stats, normalized keyword scores for balanced hybrid combination
- **Re-ranking pipeline**: Added post-retrieval re-ranking that boosts section header matches, document-level relevance signals, and penalizes noise chunks
- **Section header detection**: Chunker now auto-detects ALL CAPS, markdown, colon-terminated, and numbered section headers and attaches them as metadata
- **Conversation memory with summarization**: Older conversation turns are summarized into a compact context string, recent 4 turns kept verbatim for follow-up accuracy
- **Document status tracking**: Frontend now shows document status (ready/processing/error) with colored badges; upload queue with per-file progress indicators
- **Admin dashboard improvements**: Unified admin view with header, analytics grid layout
- **Error boundaries**: React ErrorBoundary wraps all tab content for graceful degradation
- **Retry logic**: Bedrock API calls (embeddings) now retry up to 3x with exponential backoff
- **Unit tests**: Added 20 tests covering cosine similarity, BM25 scoring, IDF, tokenization, section header detection, and chunking logic (vitest)
- **TypeScript fixes**: Added `types: ["node"]` to tsconfig; moved ExtractedText interface to shared types
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
- Textract: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
- S3: standard read/write/delete on the configured bucket
