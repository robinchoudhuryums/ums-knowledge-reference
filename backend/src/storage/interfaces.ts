import { DocumentChunk, SearchResult } from '../types';

/**
 * Storage abstraction for JSON metadata (documents index, collections, config, etc.).
 * Current implementation: S3 JSON objects under the metadata prefix.
 * Future implementation: PostgreSQL JSONB columns or normalized tables.
 */
export interface MetadataStore {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Storage abstraction for raw document files (PDFs, DOCX, images, etc.).
 * Current implementation: S3 objects.
 * Future implementation: PostgreSQL large objects or S3 (documents are large blobs).
 */
export interface DocumentStore {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getETag(key: string): Promise<string | null>;
}

/**
 * Storage abstraction for vector embeddings and similarity search.
 * Current implementation: In-memory index backed by S3 JSON persistence.
 * Future implementation: PostgreSQL with pgvector extension.
 */
export interface VectorStore {
  initialize(): Promise<void>;
  addChunks(chunks: DocumentChunk[], embeddings: number[][]): Promise<void>;
  removeDocumentChunks(documentId: string): Promise<void>;
  search(queryEmbedding: number[], queryText: string, options?: VectorSearchOptions): Promise<SearchResult[]>;
  searchByKeyword(query: string, collectionId?: string): Promise<KeywordSearchResult[]>;
  getStats(): { totalChunks: number; lastUpdated: string | null };
}

export interface VectorSearchOptions {
  topK?: number;
  collectionIds?: string[];
  tags?: string[];
  semanticWeight?: number;
  keywordWeight?: number;
}

export interface KeywordSearchResult {
  documentId: string;
  documentName: string;
  matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }>;
}
