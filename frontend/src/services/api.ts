import { Collection, Document, FeedbackRequest, QueryResponse, SourceCitation, User } from '../types';

// In dev, Vite proxies /api to localhost:3001. In production, the Express server
// serves both the API and the built frontend from the same origin.
// VITE_API_URL can override this for split deployments if needed.
const API_BASE = (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');

/**
 * Get the legacy Bearer token from localStorage (if any).
 * The primary auth mechanism is now the httpOnly cookie set by the server,
 * which is sent automatically with every request. This fallback supports
 * the transition period.
 */
function getLegacyToken(): string | null {
  return localStorage.getItem('token');
}

/**
 * Read the CSRF token from the cookie set by the server.
 * The server sets this as a non-httpOnly cookie so JS can read it.
 */
export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[2]) : null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const legacyToken = getLegacyToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  // The httpOnly cookie is the primary auth mechanism (sent automatically via credentials: 'same-origin').
  // Legacy Bearer header is kept as a fallback during migration.
  if (legacyToken) {
    headers['Authorization'] = `Bearer ${legacyToken}`;
  }

  // Include CSRF token for state-changing requests
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
  }

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) {
    // If the server rejects our token, clear stale auth and reload to show login
    if (response.status === 401) {
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      window.location.reload();
      throw new Error('Session expired. Please log in again.');
    }
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth
export async function login(username: string, password: string, mfaCode?: string): Promise<{ token: string; user: User; mfaRequired?: boolean }> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...(mfaCode && { mfaCode }) }),
  });
}

// MFA
export async function mfaSetup(): Promise<{ uri: string; secret: string }> {
  return request('/auth/mfa/setup', { method: 'POST' });
}

export async function mfaVerify(code: string): Promise<{ message: string }> {
  return request('/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function mfaDisable(password: string): Promise<{ message: string }> {
  return request('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

// ─── User Management (Admin) ─────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  email?: string;
  createdAt: string;
  lastLogin?: string;
  mustChangePassword?: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: string;
  mfaEnabled?: boolean;
  allowedCollections?: string[];
}

export async function listUsers(): Promise<{ users: AdminUser[] }> {
  return request('/users');
}

export async function createUser(username: string, password: string, role: 'admin' | 'user'): Promise<{ user: AdminUser }> {
  return request('/auth/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
}

export async function updateUserRole(userId: string, role: 'admin' | 'user'): Promise<{ user: AdminUser }> {
  return request(`/users/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  return request(`/users/${userId}`, { method: 'DELETE' });
}

export async function resetUserPassword(userId: string): Promise<{ temporaryPassword: string; message: string }> {
  return request(`/users/${userId}/reset-password`, { method: 'POST' });
}

export async function disableUserMfa(userId: string): Promise<{ message: string }> {
  return request(`/users/${userId}/mfa`, { method: 'DELETE' });
}

export async function updateUserEmail(userId: string, email: string | null): Promise<{ user: AdminUser }> {
  return request(`/users/${userId}/email`, {
    method: 'PUT',
    body: JSON.stringify({ email }),
  });
}

// Forgot password
export async function forgotPassword(username: string): Promise<{ message: string }> {
  return request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function resetPasswordWithCode(username: string, code: string, newPassword: string): Promise<{ message: string }> {
  return request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ username, code, newPassword }),
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

export async function bulkDeleteDocuments(documentIds: string[]): Promise<{ message: string; results: Array<{ id: string; name: string; status: string }> }> {
  return request('/documents/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ documentIds }),
  });
}

export async function purgeDocument(id: string): Promise<{ message: string; purgedItems: Record<string, number> }> {
  return request(`/documents/${id}/purge`, { method: 'POST' });
}

export async function getDocumentVersions(id: string): Promise<{ documentName: string; versions: Array<{ id: string; version: number; status: string; uploadedAt: string }> }> {
  return request(`/documents/${id}/versions`);
}

export async function downloadAuditLog(date: string): Promise<{ entries: Array<Record<string, unknown>> }> {
  return request(`/query-log/audit/${date}/json`);
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
// Active streaming AbortController — allows cancellation from outside (e.g. on logout)
let activeStreamController: AbortController | null = null;

/**
 * Cancel any in-flight streaming query. Called on logout to prevent
 * orphaned SSE connections that would fail with 401 after token invalidation.
 */
export function cancelActiveStream(): void {
  if (activeStreamController) {
    activeStreamController.abort();
    activeStreamController = null;
  }
}

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
  // Cancel any previous stream before starting a new one
  cancelActiveStream();
  const controller = new AbortController();
  activeStreamController = controller;

  const legacyToken = getLegacyToken();
  const csrfToken = getCsrfToken();
  const response = await fetch(`${API_BASE}/query/stream`, {
    signal: controller.signal,
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
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
  // Safety cap: if the SSE buffer grows beyond 2MB without being consumed,
  // something is wrong (malformed response, missing newlines, etc.)
  const MAX_BUFFER_SIZE = 2 * 1024 * 1024;

  // Stream timeout: if no data arrives for 120 seconds, abort.
  // This prevents the UI from hanging indefinitely if the backend stalls.
  const STREAM_TIMEOUT_MS = 120_000;
  let lastDataAt = Date.now();
  const timeoutCheck = setInterval(() => {
    if (Date.now() - lastDataAt > STREAM_TIMEOUT_MS) {
      clearInterval(timeoutCheck);
      controller.abort();
      onError('Response timed out — no data received for 2 minutes');
    }
  }, 5000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastDataAt = Date.now();
      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_BUFFER_SIZE) {
        onError('Response stream too large — connection terminated for safety');
        reader.cancel();
        return;
      }

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
  } finally {
    clearInterval(timeoutCheck);
  }

  // Clean up the controller reference when streaming completes naturally
  if (activeStreamController === controller) {
    activeStreamController = null;
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
  confidenceCategory?: 'high' | 'low';
  isRequired?: boolean;
  requiredLabel?: string;
  section?: string;
  isCheckbox?: boolean;
  isEmpty?: boolean;
}

export interface FormTypeInfo {
  key: string;
  name: string;
  description: string;
}

export interface FormReviewResult {
  filename: string;
  totalFields: number;
  emptyCount: number;
  lowConfidenceCount: number;
  requiredMissingCount: number;
  completionPercentage: number;
  pageCount: number;
  cached: boolean;
  formType: FormTypeInfo | null;
  emptyFields: FormReviewField[];
  filledFields: FormReviewField[];
  lowConfidenceFields: FormReviewField[];
  requiredMissingFields: FormReviewField[];
}

export interface BatchFormReviewResult {
  fileCount: number;
  totalCachedCount: number;
  results: Array<{
    filename: string;
    totalFields: number;
    emptyCount: number;
    requiredMissingCount: number;
    lowConfidenceCount: number;
    completionPercentage: number;
    pageCount: number;
    cached: boolean;
    formType: FormTypeInfo | null;
    emptyFields: FormReviewField[];
    requiredMissingFields: FormReviewField[];
  }>;
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
  const legacyToken = getLegacyToken();
  const csrfToken = getCsrfToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/form-review?output=annotated`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
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
  const legacyToken = getLegacyToken();
  const csrfToken = getCsrfToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/form-review?output=original`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
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

export async function reviewFormBatch(files: File[]): Promise<BatchFormReviewResult> {
  const legacyToken = getLegacyToken();
  const csrfToken = getCsrfToken();
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_BASE}/documents/form-review/batch`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
      throw new Error('Session expired');
    }
    const err = await response.json().catch(() => ({ error: 'Batch review failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Intake Data (auto-fill) types
export interface IntakeData {
  patientName?: string;
  patientDob?: string;
  patientAddress?: string;
  patientPhone?: string;
  medicareId?: string;
  physicianName?: string;
  physicianNpi?: string;
  supplierName?: string;
  hcpcsCode?: string;
  diagnosisCode?: string;
  insuranceName?: string;
  policyNumber?: string;
}

// Clinical Note Extraction types
export interface ClinicalTestResult {
  testName: string;
  result: string;
  date: string | null;
  unit: string | null;
}

export interface CmnFieldMapping {
  fieldName: string;
  suggestedValue: string;
  sourceContext: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ClinicalExtraction {
  patientName: string | null;
  patientDob: string | null;
  patientAddress: string | null;
  patientPhone: string | null;
  memberId: string | null;
  primaryDiagnosis: string | null;
  icdCodes: string[];
  secondaryDiagnoses: string[];
  testResults: ClinicalTestResult[];
  vitalSigns: Record<string, string>;
  medicalNecessityLanguage: string | null;
  previousTreatments: string[];
  functionalLimitations: string[];
  prognosis: string | null;
  equipmentRecommended: string | null;
  hcpcsCodes: string[];
  lengthOfNeed: string | null;
  physicianName: string | null;
  physicianNpi: string | null;
  encounterDate: string | null;
  confidence: 'high' | 'medium' | 'low';
  extractionNotes: string;
  modelUsed: string;
}

export interface ClinicalExtractionResult {
  extraction: ClinicalExtraction;
  fieldMappings: CmnFieldMapping[];
}

export async function extractClinicalNotes(file: File): Promise<ClinicalExtractionResult> {
  const formData = new FormData();
  formData.append('file', file);

  return request('/documents/clinical-extract', {
    method: 'POST',
    body: formData,
  });
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
  const legacyToken = getLegacyToken();
  const response = await fetch(`${API_BASE}/query-log/${date}/csv`, {
    credentials: 'same-origin',
    headers: legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {},
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
