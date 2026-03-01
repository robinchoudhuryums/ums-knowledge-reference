import { Collection, Document, QueryResponse, User } from '../types';

const API_BASE = '/api';

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

// Query
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
