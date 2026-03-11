import { Collection, Document, FeedbackRequest, QueryResponse, SourceCitation, User } from '../types';

// In dev, Vite proxies /api to localhost:3001. In production, the Express server
// serves both the API and the built frontend from the same origin.
// VITE_API_URL can override this for split deployments if needed.
const API_BASE = (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // If the server rejects our token, clear stale auth and reload to show login
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
      throw new Error('Session expired. Please log in again.');
    }
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth
export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// Change password
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ token: string; user: User }> {
  return request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// Server-side logout (revokes token)
export async function logoutServer(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

// Documents
export async function listDocuments(collectionId?: string): Promise<{ documents: Document[] }> {
  const query = collectionId ? `?collectionId=${collectionId}` : '';
  return request(`/documents${query}`);
}

export async function uploadDocument(file: File, collectionId: string): Promise<{ document: Document; chunkCount: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('collectionId', collectionId);

  return request('/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/documents/${id}`, { method: 'DELETE' });
}

// Tags
export async function updateDocumentTags(id: string, tags: string[]): Promise<{ document: Document }> {
  return request(`/documents/${id}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
}

export async function listAllTags(): Promise<{ tags: string[] }> {
  return request('/documents/tags/list');
}

// Collections
export async function listCollections(): Promise<{ collections: Collection[] }> {
  return request('/documents/collections/list');
}

export async function createCollection(name: string, description: string): Promise<{ collection: Collection }> {
  return request('/documents/collections', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteCollection(id: string): Promise<void> {
  await request(`/documents/collections/${id}`, { method: 'DELETE' });
}

// Query (non-streaming fallback)
export async function queryKnowledgeBase(
  question: string,
  collectionIds?: string[],
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<QueryResponse> {
  return request('/query', {
    method: 'POST',
    body: JSON.stringify({ question, collectionIds, conversationHistory }),
  });
}

// Query (streaming via SSE)
export async function queryKnowledgeBaseStream(
  question: string,
  collectionIds: string[] | undefined,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] | undefined,
  onText: (text: string) => void,
  onSources: (sources: SourceCitation[]) => void,
  onConfidence: (confidence: 'high' | 'partial' | 'low') => void,
  onDone: () => void,
  onError: (error: string) => void,
  onTraceId?: (traceId: string) => void,
): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/query/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question, collectionIds, conversationHistory }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
      return;
    }
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    onError(err.error || `HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('No response stream available');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'text') {
          onText(data.text);
        } else if (data.type === 'sources') {
          onSources(data.sources);
        } else if (data.type === 'confidence') {
          onConfidence(data.confidence);
        } else if (data.type === 'traceId') {
          onTraceId?.(data.traceId);
        } else if (data.type === 'done') {
          onDone();
        } else if (data.type === 'error') {
          onError(data.error);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }
}

// Feedback
export async function submitFeedback(feedback: FeedbackRequest): Promise<{ id: string }> {
  return request('/feedback', {
    method: 'POST',
    body: JSON.stringify(feedback),
  });
}

// Thumbs up/down feedback (linked to trace)
export async function submitTraceFeedback(traceId: string, feedbackType: 'thumbs_up' | 'thumbs_down', notes?: string): Promise<{ feedbackId: string }> {
  return request('/feedback/trace', {
    method: 'POST',
    body: JSON.stringify({ traceId, feedbackType, notes }),
  });
}

// Observability metrics (admin)
export interface ObservabilityMetrics {
  period: { start: string; end: string; days: number };
  totalTraces: number;
  avgResponseTimeMs: number;
  avgRetrievalScore: number;
  thumbsUp: number;
  thumbsDown: number;
  thumbsUpRatio: number;
  dailyStats: Array<{
    date: string;
    traceCount: number;
    avgResponseTimeMs: number;
    avgRetrievalScore: number;
    thumbsUp: number;
    thumbsDown: number;
  }>;
  retrievalFailures: Array<{
    traceId: string;
    date: string;
    queryText: string;
    avgRetrievalScore: number;
    confidence: string;
    responseTimeMs: number;
    feedbackNotes?: string;
  }>;
  generationFailures: Array<{
    traceId: string;
    date: string;
    queryText: string;
    avgRetrievalScore: number;
    confidence: string;
    responseTimeMs: number;
    feedbackNotes?: string;
  }>;
}

export async function getObservabilityMetrics(days?: number): Promise<ObservabilityMetrics> {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  const qs = params.toString();
  return request(`/query-log/observability/metrics${qs ? `?${qs}` : ''}`);
}

// Document search
export interface DocumentSearchResult {
  documentId: string;
  documentName: string;
  matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }>;
}

export async function searchDocuments(
  query: string,
  collectionId?: string
): Promise<{ results: DocumentSearchResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (collectionId) params.set('collectionId', collectionId);
  return request(`/documents/search/text?${params.toString()}`);
}

// OCR
export interface OcrResponse {
  text: string;
  pageCount: number;
  confidence: number;
  filename: string;
}

export async function ocrDocument(file: File): Promise<OcrResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return request('/documents/ocr', {
    method: 'POST',
    body: formData,
  });
}

// Form Review
export interface FormReviewField {
  key: string;
  value?: string;
  page: number;
  confidence: number;
}

export interface FormReviewResult {
  filename: string;
  totalFields: number;
  emptyCount: number;
  pageCount: number;
  emptyFields: FormReviewField[];
  filledFields: FormReviewField[];
}

export async function reviewForm(file: File): Promise<FormReviewResult> {
  const formData = new FormData();
  formData.append('file', file);

  return request('/documents/form-review?output=json', {
    method: 'POST',
    body: formData,
  });
}

export async function downloadAnnotatedPdf(file: File): Promise<Blob> {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/form-review?output=annotated`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
      throw new Error('Session expired');
    }
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.blob();
}

export async function downloadOriginalPdf(file: File): Promise<Blob> {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/form-review?output=original`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
      throw new Error('Session expired');
    }
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.blob();
}

// FAQ dashboard (admin)
export interface FaqDashboardData {
  period: { start: string; end: string };
  totalQueries: number;
  uniqueAgents: number;
  confidenceBreakdown: { high: number; partial: number; low: number };
  topQuestions: Array<{
    question: string;
    frequency: number;
    lastAsked: string;
    avgConfidence: string;
    agents: string[];
  }>;
  lowConfidenceQuestions: Array<{
    question: string;
    frequency: number;
    lastAsked: string;
    avgConfidence: string;
    agents: string[];
  }>;
  agentActivity: Array<{ username: string; queryCount: number; avgConfidence: string }>;
  queriesByDay: Array<{ date: string; count: number }>;
}

export async function getFaqDashboard(start?: string, end?: string): Promise<FaqDashboardData> {
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const qs = params.toString();
  return request(`/query-log/faq/dashboard${qs ? `?${qs}` : ''}`);
}

// Quality metrics (admin)
export interface QualityMetrics {
  period: { start: string; end: string; days: number };
  totalQueries: number;
  totalFlagged: number;
  confidenceCounts: { high: number; partial: number; low: number };
  qualityScore: number;
  unansweredQuestions: Array<{ question: string; date: string }>;
  dailyStats: Array<{ date: string; queries: number; flagged: number; highPct: number }>;
}

export async function getQualityMetrics(days?: number): Promise<QualityMetrics> {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  const qs = params.toString();
  return request(`/query-log/quality/metrics${qs ? `?${qs}` : ''}`);
}

// Extraction templates
export interface ExtractionTemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  fieldCount: number;
}

export interface ExtractionTemplateField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'boolean' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
  description?: string;
  group?: string;
}

export interface ExtractionTemplateDetail {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: ExtractionTemplateField[];
}

export interface ExtractionResult {
  templateId: string;
  templateName: string;
  data: Record<string, string | number | boolean | null>;
  confidence: 'high' | 'medium' | 'low';
  extractionNotes: string;
  modelUsed: string;
}

export async function listExtractionTemplates(): Promise<{ templates: ExtractionTemplateInfo[] }> {
  return request('/extraction/templates');
}

export async function getExtractionTemplate(id: string): Promise<{ template: ExtractionTemplateDetail }> {
  return request(`/extraction/templates/${id}`);
}

export async function extractDocument(file: File, templateId: string): Promise<{ result: ExtractionResult }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('templateId', templateId);
  return request('/extraction/extract', {
    method: 'POST',
    body: formData,
  });
}

export async function getExtractionModel(): Promise<{ model: string }> {
  return request('/extraction/model');
}

// Query log (admin) — downloads CSV as a blob and triggers browser download
export async function downloadQueryLogCsv(date: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/query-log/${date}/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `query-log-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
