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
  tags?: string[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  documentCount: number;
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

export interface QueryResponse {
  answer: string;
  sources: SourceCitation[];
  confidence: 'high' | 'partial' | 'low';
  traceId?: string;
}

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
  confidence?: 'high' | 'partial' | 'low';
  traceId?: string;
  isError?: boolean;
  productImages?: Array<{
    hcpcsCode: string;
    productName: string;
    imageUrl: string;
    brochureUrl?: string;
  }>;
}

export interface FeedbackRequest {
  question: string;
  answer: string;
  patientName?: string;
  transactionNumber?: string;
  notes?: string;
  sources: Array<{ documentName: string; chunkId: string; score: number }>;
  traceId?: string;
  feedbackType?: 'thumbs_up' | 'thumbs_down';
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mfaEnabled?: boolean;
}

export interface AuthState {
  token: string | null;
  user: User | null;
}
