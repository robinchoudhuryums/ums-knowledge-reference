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
  status: 'uploading' | 'processing' | 'ready' | 'error';
  errorMessage?: string;
  chunkCount: number;
  version: number;
  previousVersionId?: string;
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
  action: 'query' | 'upload' | 'delete' | 'login' | 'collection_create' | 'collection_delete';
  details: Record<string, unknown>;
}

export interface VectorStoreIndex {
  version: number;
  lastUpdated: string;
  chunks: StoredChunk[];
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
