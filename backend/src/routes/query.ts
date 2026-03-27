import { Router, Response } from 'express';
import { authenticate, AuthRequest, getUserAllowedCollections } from '../middleware/auth';
import { generateEmbedding } from '../services/embeddings';
import { searchVectorStore } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { checkAndRecordQuery, rollbackQuery } from '../services/usage';
import { logQuery } from '../services/queryLog';
import { generateTraceId, logRagTrace } from '../services/ragTrace';
import { QueryRequest, QueryResponse, SourceCitation, ConversationTurn, SearchResult } from '../types';
import { InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';
import { enrichQueryWithStructuredData } from '../services/referenceEnrichment';

const router = Router();

const REFORMULATION_PROMPT = `Given the conversation so far and the user's latest message, rewrite the latest message as a standalone search query that captures the full intent. Include key terms from prior context that are needed to search accurately. Return ONLY the reformulated query, nothing else.`;

/**
 * Reformulate a follow-up question into a standalone search query using conversation context.
 * This improves retrieval for follow-ups like "what about for pediatric patients?"
 * by expanding to "wheelchair procedures for pediatric patients".
 */
async function reformulateQuery(
  question: string,
  conversationHistory: ConversationTurn[]
): Promise<string> {
  // Only reformulate if there's meaningful conversation history
  if (!conversationHistory || conversationHistory.length < 2) return question;

  // Build a compact conversation summary for context
  const recentTurns = conversationHistory.slice(-4);
  const turnText = recentTurns
    .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 200)}`)
    .join('\n');

  try {
    const command = new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `Conversation:\n${turnText}\n\nLatest user message: ${question}\n\nRewrite as a standalone search query:`,
          },
        ],
        system: [{ type: 'text', text: REFORMULATION_PROMPT, cache_control: { type: 'ephemeral' } }],
        temperature: 0,
      }),
    });

    const response = await bedrockClient.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const reformulated = body.content?.[0]?.text?.trim();

    if (reformulated && reformulated.length > 3 && reformulated.length < 500) {
      logger.info('Query reformulated', { original: question, reformulated });
      return reformulated;
    }
  } catch (error) {
    logger.warn('Query reformulation failed, using original', { error: String(error) });
  }

  return question;
}

const SYSTEM_PROMPT = `You are the UMS Knowledge Base Assistant — an expert reference tool for Universal Medical Supply, a medical supply company. Your role is to answer questions accurately using ONLY the provided document context.

Guidelines:
- Be concise by default — lead with the direct answer, then provide supporting details. Use bullet points for multi-part answers. For simple factual questions, 1-3 sentences is ideal.
- Base every claim on the provided source documents. Cite sources inline using [Source N] notation.
- If the context does not contain enough information to answer, clearly state: "This information is not covered in the current knowledge base documents." Then suggest the user contact the appropriate department or person for guidance. NEVER make up information or draw from general knowledge outside the provided context.
- When multiple sources agree, synthesize them. When they conflict, note the discrepancy.
- For procedural questions, provide step-by-step answers when the source material supports it.
- Use clear, professional language appropriate for a healthcare/medical supply workplace.
- Format responses with markdown: use **bold** for key terms, bullet lists for steps/items, and headers for multi-part answers.
- You may receive "Structured Reference" blocks containing HCPCS codes, ICD-10 crosswalks, or LCD coverage checklists from verified CMS data. Treat these as authoritative reference data and cite them as [Structured Reference] when used. Integrate them naturally with document-based answers.
- At the end of your response, on a new line, output a confidence tag in exactly this format: [CONFIDENCE: HIGH], [CONFIDENCE: PARTIAL], or [CONFIDENCE: LOW] based on how well the source documents cover the question. HIGH means the documents directly address the question. PARTIAL means some relevant information exists but the answer may be incomplete. LOW means little or no relevant information was found in the documents.`;

/**
 * Build the system prompt as a content block array with cache_control.
 * Bedrock prompt caching saves up to 90% on repeated system prompt tokens.
 * The cache_control breakpoint tells Bedrock to cache everything up to and
 * including that block. Cache reads cost 0.1x base input price.
 */
function buildSystemBlocks(): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  return [
    {
      type: 'text' as const,
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' as const },
    },
  ];
}

// Score-based confidence thresholds for fallback when model doesn't output a confidence tag.
// Tuned for hybrid search (0.7 semantic + 0.3 keyword) where typical score ranges are:
// - Strong match: 0.55+ (query terms appear in text AND embedding is very similar)
// - Moderate match: 0.40-0.55 (good semantic match but partial keyword overlap)
// - Weak match: <0.40 (tangentially related content)
const LOW_CONFIDENCE_THRESHOLD = 0.35;
const PARTIAL_CONFIDENCE_THRESHOLD = 0.45;

/**
 * Summarize older conversation turns into a compact context string.
 * Keeps recent turns verbatim, compresses older ones.
 */
function summarizeOlderTurns(
  history: ConversationTurn[],
  recentCount: number = 4
): string | null {
  if (history.length <= recentCount) return null;

  const older = history.slice(0, history.length - recentCount);
  const topics = older
    .filter(t => t.role === 'user')
    .map(t => t.content.length > 100 ? t.content.slice(0, 100) + '...' : t.content);

  if (topics.length === 0) return null;

  return `Earlier in this conversation, the user asked about: ${topics.join('; ')}`;
}

function buildMessages(
  question: string,
  context: string,
  conversationHistory?: ConversationTurn[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (conversationHistory && conversationHistory.length > 0) {
    const recentCount = 4;
    const summary = summarizeOlderTurns(conversationHistory, recentCount);

    if (summary) {
      messages.push({ role: 'user', content: summary });
      messages.push({ role: 'assistant', content: 'Understood, I have that context.' });
    }

    const recentTurns = conversationHistory.slice(-recentCount);
    for (const turn of recentTurns) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  // Current question with retrieved context
  // Use XML-style tags to clearly delineate context from user query,
  // making it harder for injected content in documents to be treated as instructions
  messages.push({
    role: 'user',
    content: `<document_context>\n${context}\n</document_context>\n\n<user_question>\n${question}\n</user_question>`,
  });

  return messages;
}

function buildContext(searchResults: SearchResult[], enrichments?: Array<{ contextBlock: string; sourceLabel: string }>): string {
  const parts: string[] = [];

  // Prepend structured reference data if available
  if (enrichments && enrichments.length > 0) {
    for (const e of enrichments) {
      parts.push(`[Structured Reference: ${e.sourceLabel}]\n${e.contextBlock}`);
    }
    parts.push('--- Document Sources Below ---');
  }

  // Standard RAG document chunks
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const pageInfo = result.chunk.pageNumber ? ` | Page ${result.chunk.pageNumber}` : '';
    const section = result.chunk.sectionHeader ? ` | Section: ${result.chunk.sectionHeader}` : '';
    parts.push(`[Source ${i + 1}: ${result.document.originalName}${pageInfo}${section}]\n${result.chunk.text}`);
  }

  return parts.join('\n\n---\n\n');
}

function buildSourceCitations(searchResults: SearchResult[]): SourceCitation[] {
  return searchResults.map(result => ({
    documentId: result.document.id,
    documentName: result.document.originalName,
    chunkId: result.chunk.id,
    text: result.chunk.text,
    pageNumber: result.chunk.pageNumber,
    sectionHeader: result.chunk.sectionHeader,
    score: result.score,
  }));
}

/**
 * Parse the confidence tag from the LLM response and strip it from the visible answer.
 * Falls back to score-based confidence if no tag is found.
 * When using score-based fallback, considers both the average score and the top score
 * to better reflect retrieval quality (a single strong match is still useful).
 */
// If retrieval scores are below this threshold, the model's confidence tag
// is downgraded even if it says HIGH. This prevents the model from being
// over-confident when the retrieved chunks barely match the query.
const RECONCILIATION_FLOOR = 0.25;

function parseConfidence(
  rawAnswer: string,
  avgScore: number,
  topScore?: number
): { answer: string; confidence: 'high' | 'partial' | 'low' } {
  const tagMatch = rawAnswer.match(/\[CONFIDENCE:\s*(HIGH|PARTIAL|LOW)\]\s*$/i);

  if (tagMatch) {
    let confidence = tagMatch[1].toLowerCase() as 'high' | 'partial' | 'low';
    const answer = rawAnswer.slice(0, tagMatch.index).trimEnd();

    // Reconciliation: if retrieval scores are very low but the model says HIGH,
    // the model may be hallucinating or over-extrapolating from weak context.
    // Downgrade confidence to prevent misleading users.
    const effectiveScore = topScore !== undefined
      ? avgScore * 0.6 + topScore * 0.4
      : avgScore;

    if (confidence === 'high' && effectiveScore < RECONCILIATION_FLOOR) {
      confidence = 'partial';
    } else if (confidence !== 'low' && effectiveScore < RECONCILIATION_FLOOR * 0.5) {
      confidence = 'low';
    }

    return { answer, confidence };
  }

  // Fallback: use retrieval scores with blended signal.
  // Blend average and top score — a single strong match should lift confidence,
  // but uniformly weak results should pull it down.
  const effectiveScore = topScore !== undefined
    ? avgScore * 0.6 + topScore * 0.4
    : avgScore;

  let confidence: 'high' | 'partial' | 'low';
  if (effectiveScore >= PARTIAL_CONFIDENCE_THRESHOLD) confidence = 'high';
  else if (effectiveScore >= LOW_CONFIDENCE_THRESHOLD) confidence = 'partial';
  else confidence = 'low';

  return { answer: rawAnswer, confidence };
}

/**
 * Sanitize user input: trim whitespace, enforce max length, strip control characters.
 */
function sanitizeInput(text: string, maxLength: number = 2000): string {
  // Remove control characters except newlines and tabs
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

/**
 * Detect potential prompt injection attempts in user queries.
 * Returns true if the query contains suspicious patterns that attempt to
 * override system instructions or manipulate the LLM's behavior.
 */
function detectPromptInjection(text: string): { detected: boolean; reason?: string } {
  // Patterns that attempt to override or ignore system instructions
  const injectionPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
    { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
    { pattern: /forget\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
    { pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i, reason: 'Role reassignment attempt' },
    { pattern: /new\s+instructions?:\s*/i, reason: 'Instruction injection attempt' },
    { pattern: /system\s*prompt\s*[:=]/i, reason: 'System prompt manipulation attempt' },
    { pattern: /\bdo\s+not\s+follow\s+(the\s+)?(system|above|previous)\b/i, reason: 'Instruction override attempt' },
    { pattern: /pretend\s+(you('re|\s+are)\s+)?(not\s+)?(a|an|the)\s+/i, reason: 'Role manipulation attempt' },
    { pattern: /act\s+as\s+(if\s+)?(you('re|\s+are)\s+)?(a|an|the|my)\s+/i, reason: 'Role manipulation attempt' },
    { pattern: /\[system\]|\[inst\]|\[\/inst\]|<\|system\|>|<\|user\|>|<\|assistant\|>/i, reason: 'Chat template injection' },
    { pattern: /```\s*(system|instruction|prompt)/i, reason: 'Code block instruction injection' },
    { pattern: /override\s+(the\s+)?(system|safety|content)\s+(prompt|filter|policy)/i, reason: 'Safety override attempt' },
  ];

  for (const { pattern, reason } of injectionPatterns) {
    if (pattern.test(text)) {
      return { detected: true, reason };
    }
  }

  // Check for excessive special delimiters that may try to break context framing
  const delimiterCount = (text.match(/---+|===+|####+|\*\*\*+/g) || []).length;
  if (delimiterCount > 5) {
    return { detected: true, reason: 'Excessive delimiters may indicate context manipulation' };
  }

  return { detected: false };
}

/**
 * Output-side guardrail: detect if the LLM response shows signs of a successful
 * prompt injection that bypassed input detection. If the response references system
 * instructions, reveals internal prompts, or deviates from the knowledge-base role,
 * we replace it with a safe fallback rather than forwarding to the user.
 */
function detectOutputAnomaly(responseText: string): { anomaly: boolean; reason?: string } {
  const lower = responseText.toLowerCase();

  // Check if the model leaked/referenced the system prompt or its instructions
  const leakPatterns = [
    /my (?:system |internal )?(?:prompt|instructions?) (?:say|tell|are|is)/i,
    /here (?:is|are) my (?:system |internal )?(?:prompt|instructions?)/i,
    /i(?:'m| am) (?:actually |really )?(?:an? )?(?:AI|language model|LLM|chatbot|assistant)(?:,| and| that)/i,
    /as an? (?:AI|language model|LLM)/i,
  ];

  for (const pattern of leakPatterns) {
    if (pattern.test(responseText)) {
      return { anomaly: true, reason: 'Response may reference internal instructions' };
    }
  }

  // Check if the model stopped acting as the UMS Knowledge Base Assistant
  // (e.g. started writing code, translating, composing emails unrelated to documents)
  if (lower.includes('here is the python code') ||
      lower.includes('here is the javascript') ||
      lower.includes('dear sir/madam') ||
      lower.includes('as a creative writing exercise')) {
    return { anomaly: true, reason: 'Response deviates from knowledge base role' };
  }

  return { anomaly: false };
}

const OUTPUT_ANOMALY_REPLACEMENT =
  'I can only answer questions based on the uploaded knowledge base documents. ' +
  'Please rephrase your question to ask about the documents in the system.';

/**
 * Validate and sanitize conversation history to prevent abuse.
 * Limits the number of turns, total character count, and validates structure.
 */
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_CHARS = 50_000;

function sanitizeConversationHistory(history?: ConversationTurn[]): ConversationTurn[] {
  if (!history || !Array.isArray(history)) return [];

  // Limit number of turns
  const limited = history.slice(-MAX_HISTORY_TURNS);

  // Validate structure and cap individual turn content
  let totalChars = 0;
  const valid: ConversationTurn[] = [];
  for (const turn of limited) {
    if (!turn || typeof turn.content !== 'string' ||
        (turn.role !== 'user' && turn.role !== 'assistant')) {
      continue; // Skip malformed turns
    }
    const content = turn.content.slice(0, 5000); // Cap individual turn at 5K chars
    totalChars += content.length;
    if (totalChars > MAX_HISTORY_CHARS) break; // Stop if total budget exceeded
    valid.push({ role: turn.role, content });
  }

  return valid;
}

// Standard (non-streaming) query endpoint
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question: rawQuestion, collectionIds, conversationHistory: rawHistory, topK }: QueryRequest = req.body;
    const question = rawQuestion ? sanitizeInput(rawQuestion) : '';
    const conversationHistory = sanitizeConversationHistory(rawHistory);

    if (!question) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Detect prompt injection attempts before processing
    const injectionCheck = detectPromptInjection(question);
    if (injectionCheck.detected) {
      logger.warn('Prompt injection detected', { userId: req.user!.id, reason: injectionCheck.reason });
      res.status(400).json({ error: 'Your query contains patterns that cannot be processed. Please rephrase your question.' });
      return;
    }

    // Atomically check usage limit and record the query to prevent races
    const usageCheck = await checkAndRecordQuery(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    const traceId = generateTraceId();
    const pipelineStart = Date.now();

    logger.info('Query received', { question, userId: req.user!.id, traceId });

    // Enforce collection-level access control
    const allowedCollections = await getUserAllowedCollections(req.user!.id, req.user!.role);
    let effectiveCollectionIds = collectionIds;
    if (allowedCollections) {
      // User has collection restrictions — intersect requested with allowed
      effectiveCollectionIds = collectionIds?.length
        ? collectionIds.filter(id => allowedCollections.includes(id))
        : allowedCollections;
    }

    // Reformulate follow-up questions for better retrieval
    const searchQuery = await reformulateQuery(question, conversationHistory);

    const embeddingStart = Date.now();
    const queryEmbedding = await generateEmbedding(searchQuery);
    const embeddingTimeMs = Date.now() - embeddingStart;

    const retrievalStart = Date.now();
    const searchResults = await searchVectorStore(queryEmbedding, searchQuery, {
      topK: topK || 6,
      collectionIds: effectiveCollectionIds,
    });
    const retrievalTimeMs = Date.now() - retrievalStart;

    if (searchResults.length === 0) {
      // Usage already recorded by checkAndRecordQuery above
      const responseTimeMs = Date.now() - pipelineStart;
      const response: QueryResponse = {
        answer:
          "This information is not covered in the current knowledge base documents. Please contact your supervisor or the relevant department for guidance, or try rephrasing your question.",
        sources: [],
        confidence: 'low',
        traceId,
      };
      // Log trace for zero-result queries too (redact PHI from logged text)
      logRagTrace({
        traceId, timestamp: new Date().toISOString(),
        userId: req.user!.id, username: req.user!.username,
        queryText: redactPhi(question).text, reformulatedQuery: searchQuery !== question ? redactPhi(searchQuery).text : undefined,
        retrievedChunkIds: [], retrievalScores: [], avgRetrievalScore: 0,
        chunksPassedToModel: 0, modelId: BEDROCK_GENERATION_MODEL,
        responseText: response.answer, confidence: 'low',
        responseTimeMs, embeddingTimeMs, retrievalTimeMs,
        collectionIds, streamed: false,
      }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
      res.json(response);
      return;
    }

    // Enrich with structured reference data (HCPCS, ICD-10, checklists)
    const enrichments = enrichQueryWithStructuredData(question);

    const context = buildContext(searchResults, enrichments);
    const messages = buildMessages(question, context, conversationHistory);

    const generationStart = Date.now();
    const command = new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: buildSystemBlocks(),
        messages,
        temperature: 0.15,
      }),
    });

    const bedrockResponse = await bedrockClient.send(command);
    const generationTimeMs = Date.now() - generationStart;
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const rawAnswer = responseBody.content?.[0]?.text || 'Unable to generate a response.';
    // Log cache usage if available (cache_read_input_tokens / cache_creation_input_tokens)
    if (responseBody.usage?.cache_read_input_tokens || responseBody.usage?.cache_creation_input_tokens) {
      logger.info('Prompt cache stats', {
        traceId,
        cacheRead: responseBody.usage.cache_read_input_tokens || 0,
        cacheCreation: responseBody.usage.cache_creation_input_tokens || 0,
      });
    }
    const inputTokens = responseBody.usage?.input_tokens;
    const outputTokens = responseBody.usage?.output_tokens;

    const avgScore = searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
    const topScore = searchResults.length > 0 ? Math.max(...searchResults.map(r => r.score)) : 0;
    let { answer, confidence } = parseConfidence(rawAnswer, avgScore, topScore);

    // Output-side guardrail: detect if the response shows signs of injection bypass
    const outputCheck = detectOutputAnomaly(answer);
    if (outputCheck.anomaly) {
      logger.warn('Output anomaly detected, replacing response', {
        reason: outputCheck.reason, userId: req.user!.id, traceId,
      });
      answer = OUTPUT_ANOMALY_REPLACEMENT;
      confidence = 'low';
    }

    const sources = buildSourceCitations(searchResults);
    const responseTimeMs = Date.now() - pipelineStart;

    // Usage already recorded by checkAndRecordQuery above

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question: redactPhi(question).text,
      sourcesUsed: sources.length,
      accessedDocumentIds: [...new Set(sources.map(s => s.documentId))],
      accessedDocumentNames: [...new Set(sources.map(s => s.documentName))],
      collectionIds: effectiveCollectionIds,
      confidence,
      traceId,
    });

    // Log query for analytics / CSV export
    await logQuery(req.user!.id, req.user!.username, question, answer, confidence, sources, collectionIds);

    // Log RAG trace asynchronously (fire-and-forget)
    // Redact reformulated query — it may contain PHI expanded from conversation context
    const redactedReformulated = searchQuery !== question ? redactPhi(searchQuery).text : undefined;
    logRagTrace({
      traceId, timestamp: new Date().toISOString(),
      userId: req.user!.id, username: req.user!.username,
      queryText: redactPhi(question).text, reformulatedQuery: redactedReformulated,
      retrievedChunkIds: searchResults.map(r => r.chunk.id),
      retrievalScores: searchResults.map(r => r.score),
      avgRetrievalScore: avgScore,
      chunksPassedToModel: searchResults.length,
      modelId: BEDROCK_GENERATION_MODEL,
      responseText: answer, confidence,
      responseTimeMs, embeddingTimeMs, retrievalTimeMs, generationTimeMs,
      collectionIds, streamed: false,
      inputTokens, outputTokens,
    }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));

    const response: QueryResponse = { answer, sources, confidence, traceId };
    res.json(response);
  } catch (error) {
    logger.error('Query failed', { error: String(error) });
    // Roll back usage so users don't lose quota on failed queries
    rollbackQuery(req.user!.id).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
    res.status(500).json({ error: 'Query processing failed' });
  }
});

// Streaming query endpoint — sends answer tokens as Server-Sent Events
router.post('/stream', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question: rawQuestion, collectionIds, conversationHistory: rawHistory, topK }: QueryRequest = req.body;
    const question = rawQuestion ? sanitizeInput(rawQuestion) : '';
    const conversationHistory = sanitizeConversationHistory(rawHistory);

    if (!question) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Detect prompt injection attempts before processing
    const injectionCheck = detectPromptInjection(question);
    if (injectionCheck.detected) {
      logger.warn('Prompt injection detected in stream', { userId: req.user!.id, reason: injectionCheck.reason });
      res.status(400).json({ error: 'Your query contains patterns that cannot be processed. Please rephrase your question.' });
      return;
    }

    // Atomically check usage limit and record the query to prevent races
    const usageCheck = await checkAndRecordQuery(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    const traceId = generateTraceId();
    const pipelineStart = Date.now();

    logger.info('Streaming query received', { question, userId: req.user!.id, traceId });

    // Enforce collection-level access control
    const allowedCollections = await getUserAllowedCollections(req.user!.id, req.user!.role);
    let effectiveCollectionIds = collectionIds;
    if (allowedCollections) {
      effectiveCollectionIds = collectionIds?.length
        ? collectionIds.filter(id => allowedCollections.includes(id))
        : allowedCollections;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Reformulate follow-up questions for better retrieval
    const searchQuery = await reformulateQuery(question, conversationHistory);

    const embeddingStart = Date.now();
    const queryEmbedding = await generateEmbedding(searchQuery);
    const embeddingTimeMs = Date.now() - embeddingStart;

    const retrievalStart = Date.now();
    const searchResults = await searchVectorStore(queryEmbedding, searchQuery, {
      topK: topK || 6,
      collectionIds: effectiveCollectionIds,
    });
    const retrievalTimeMs = Date.now() - retrievalStart;

    const avgScore = searchResults.length > 0
      ? searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length
      : 0;
    const topScore = searchResults.length > 0 ? Math.max(...searchResults.map(r => r.score)) : 0;

    // Send sources and initial confidence hint
    const sources = buildSourceCitations(searchResults);
    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

    if (searchResults.length === 0) {
      const noResultAnswer = "This information is not covered in the current knowledge base documents. Please contact your supervisor or the relevant department for guidance, or try rephrasing your question.";
      res.write(`data: ${JSON.stringify({ type: 'text', text: noResultAnswer })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'confidence', confidence: 'low' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'traceId', traceId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      // Usage already recorded by checkAndRecordQuery above
      logRagTrace({
        traceId, timestamp: new Date().toISOString(),
        userId: req.user!.id, username: req.user!.username,
        queryText: redactPhi(question).text, reformulatedQuery: searchQuery !== question ? redactPhi(searchQuery).text : undefined,
        retrievedChunkIds: [], retrievalScores: [], avgRetrievalScore: 0,
        chunksPassedToModel: 0, modelId: BEDROCK_GENERATION_MODEL,
        responseText: noResultAnswer, confidence: 'low',
        responseTimeMs: Date.now() - pipelineStart, embeddingTimeMs, retrievalTimeMs,
        collectionIds, streamed: true,
      }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
      return;
    }

    // Enrich with structured reference data (HCPCS, ICD-10, checklists)
    const enrichments = enrichQueryWithStructuredData(question);

    const context = buildContext(searchResults, enrichments);
    const messages = buildMessages(question, context, conversationHistory);

    const generationStart = Date.now();
    const command = new InvokeModelWithResponseStreamCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: buildSystemBlocks(),
        messages,
        temperature: 0.15,
      }),
    });

    const bedrockResponse = await bedrockClient.send(command);

    let fullAnswer = '';
    let streamInputTokens: number | undefined;
    let streamOutputTokens: number | undefined;
    if (bedrockResponse.body) {
      for await (const event of bedrockResponse.body) {
        if (event.chunk?.bytes) {
          const parsed = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullAnswer += parsed.delta.text;
            res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
          } else if (parsed.type === 'message_delta' && parsed.usage) {
            streamOutputTokens = parsed.usage.output_tokens;
          } else if (parsed.type === 'message_start' && parsed.message?.usage) {
            streamInputTokens = parsed.message.usage.input_tokens;
          }
        }
      }
    }
    const generationTimeMs = Date.now() - generationStart;

    // Parse confidence from the completed answer
    let { confidence } = parseConfidence(fullAnswer, avgScore, topScore);

    // Output-side guardrail for streaming: check completed answer for anomalies.
    // Since text was already streamed, we send a warning event so the frontend can
    // overlay a caution message rather than silently forwarding a suspicious response.
    const streamOutputCheck = detectOutputAnomaly(fullAnswer);
    if (streamOutputCheck.anomaly) {
      logger.warn('Output anomaly detected in streamed response', {
        reason: streamOutputCheck.reason, userId: req.user!.id, traceId,
      });
      confidence = 'low';
      res.write(`data: ${JSON.stringify({ type: 'warning', message: OUTPUT_ANOMALY_REPLACEMENT })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'confidence', confidence })}\n\n`);
    // Send traceId so frontend can link feedback to this trace
    res.write(`data: ${JSON.stringify({ type: 'traceId', traceId })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    const responseTimeMs = Date.now() - pipelineStart;

    // Usage already recorded by checkAndRecordQuery above; just log audit
    logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question: redactPhi(question).text,
      sourcesUsed: sources.length,
      accessedDocumentIds: [...new Set(sources.map(s => s.documentId))],
      accessedDocumentNames: [...new Set(sources.map(s => s.documentName))],
      collectionIds: effectiveCollectionIds,
      confidence,
      streamed: true,
      traceId,
    }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
    // Log query for analytics / CSV export
    const { answer: cleanAnswer } = parseConfidence(fullAnswer, avgScore, topScore);
    logQuery(req.user!.id, req.user!.username, question, cleanAnswer, confidence, sources, collectionIds).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
    // Log RAG trace (fire and forget)
    // Redact query and reformulated query — may contain PHI from conversation context
    const redactedStreamReformulated = searchQuery !== question ? redactPhi(searchQuery).text : undefined;
    logRagTrace({
      traceId, timestamp: new Date().toISOString(),
      userId: req.user!.id, username: req.user!.username,
      queryText: redactPhi(question).text, reformulatedQuery: redactedStreamReformulated,
      retrievedChunkIds: searchResults.map(r => r.chunk.id),
      retrievalScores: searchResults.map(r => r.score),
      avgRetrievalScore: avgScore,
      chunksPassedToModel: searchResults.length,
      modelId: BEDROCK_GENERATION_MODEL,
      responseText: cleanAnswer, confidence,
      responseTimeMs, embeddingTimeMs, retrievalTimeMs, generationTimeMs,
      collectionIds, streamed: true,
      inputTokens: streamInputTokens, outputTokens: streamOutputTokens,
    }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
  } catch (error) {
    logger.error('Streaming query failed', { error: String(error) });
    // Roll back usage so users don't lose quota on failed queries
    rollbackQuery(req.user!.id).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Query processing failed' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Query processing failed' });
    }
  }
});

export default router;
