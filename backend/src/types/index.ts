export interface ExtractedText {
  text: string;
  pageBreaks?: number[];
  /** OCR confidence (0-100) when text was extracted via Textract. Undefined for non-OCR extraction. */
  ocrConfidence?: number;
}

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  collectionId: string;
  uploadedBy: string;
  uploadedAt: string;
  status: 'uploading' | 'processing' | 'ready' | 'error' | 'replaced';
  errorMessage?: string;
  chunkCount: number;
  version: number;
  previousVersionId?: string;
  tags?: string[];
  contentHash?: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  pageNumber?: number;
  sectionHeader?: string;
  embedding?: number[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  documentCount: number;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  createdAt: string;
  mustChangePassword?: boolean;
  /** Previous password hashes for reuse prevention (most recent first) */
  passwordHistory?: string[];
  /** Number of consecutive failed login attempts */
  failedLoginAttempts?: number;
  /** ISO timestamp when account was locked out */
  lockedUntil?: string;
  /** ISO timestamp of last successful login */
  lastLogin?: string;
  /** Collection IDs this user can access. Admins bypass this. Empty/undefined = all collections. */
  allowedCollections?: string[];
}

export interface SearchResult {
  chunk: DocumentChunk;
  document: Document;
  score: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  action: 'query' | 'upload' | 'delete' | 'login' | 'collection_create' | 'collection_delete' | 'feedback' | 'ocr' | 'user_create' | 'user_update' | 'user_delete' | 'user_reset_password' | 'data_purge' | 'data_retention' | 'document_replaced';
  details: Record<string, unknown>;
  previousHash?: string;
  entryHash?: string;
}

export interface VectorStoreIndex {
  version: number;
  lastUpdated: string;
  chunks: StoredChunk[];
  embeddingModel?: string;    // Model used for embeddings
  embeddingDimensions?: number; // Dimension count
}

export interface StoredChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  pageNumber?: number;
  sectionHeader?: string;
  embedding: number[];
}

export interface QueryRequest {
  question: string;
  collectionIds?: string[];
  conversationHistory?: ConversationTurn[];
  topK?: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface QueryResponse {
  answer: string;
  sources: SourceCitation[];
  confidence: 'high' | 'partial' | 'low';
  traceId?: string;
  /** True if the response was flagged as potentially containing PHI from source documents */
  phiDetected?: boolean;
}

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  queryId: string;
  question: string;
  answer: string;
  patientName?: string;
  transactionNumber?: string;
  notes?: string;
  sources: SourceCitation[];
}

export interface UsageRecord {
  date: string;
  users: Record<string, { queryCount: number; lastQuery: string }>;
  totalQueries: number;
}

export interface UsageLimits {
  dailyPerUser: number;
  dailyTotal: number;
  monthlyTotal: number;
}

export interface QueryLogEntry {
  timestamp: string;
  userId: string;
  username: string;
  question: string;
  answer: string;
  confidence: 'high' | 'partial' | 'low';
  sourceDocuments: string;
  sourceCount: number;
  collectionIds?: string[];
}

export interface SourceCitation {
  documentId: string;
  documentName: string;
  chunkId: string;
  text: string;
  pageNumber?: number;
  sectionHeader?: string;
  score: number;
}

export interface MonitoredSource {
  id: string;
  name: string;
  url: string;
  collectionId: string;
  /** How often to check for updates (hours) */
  checkIntervalHours: number;
  /** File type hint: 'auto' | 'pdf' | 'csv' | 'txt' | 'html' */
  fileType: 'auto' | 'pdf' | 'csv' | 'txt' | 'html';
  /** Whether this source is actively monitored */
  enabled: boolean;
  /** Category for grouping in the UI */
  category: string;
  createdBy: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastContentHash?: string;
  lastIngestedAt?: string;
  lastDocumentId?: string;
  lastError?: string;
  /** HTTP status from last check */
  lastHttpStatus?: number;
}
