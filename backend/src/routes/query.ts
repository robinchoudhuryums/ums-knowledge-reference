import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { generateEmbedding } from '../services/embeddings';
import { searchVectorStore } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { checkUsageLimit, recordQuery } from '../services/usage';
import { logQuery } from '../services/queryLog';
import { generateTraceId, logRagTrace } from '../services/ragTrace';
import { QueryRequest, QueryResponse, SourceCitation, ConversationTurn, SearchResult } from '../types';
import { InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';

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

// Minimum average similarity score to consider results relevant
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const PARTIAL_CONFIDENCE_THRESHOLD = 0.5;

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
  messages.push({
    role: 'user',
    content: `Here are the relevant document excerpts to reference:\n\n${context}\n\n---\n\nQuestion: ${question}`,
  });

  return messages;
}

function buildContext(searchResults: SearchResult[]): string {
  return searchResults
    .map((result, i) => {
      const pageInfo = result.chunk.pageNumber ? ` | Page ${result.chunk.pageNumber}` : '';
      const section = result.chunk.sectionHeader ? ` | Section: ${result.chunk.sectionHeader}` : '';
      return `[Source ${i + 1}: ${result.document.originalName}${pageInfo}${section}]\n${result.chunk.text}`;
    })
    .join('\n\n---\n\n');
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
 */
function parseConfidence(
  rawAnswer: string,
  avgScore: number
): { answer: string; confidence: 'high' | 'partial' | 'low' } {
  const tagMatch = rawAnswer.match(/\[CONFIDENCE:\s*(HIGH|PARTIAL|LOW)\]\s*$/i);

  if (tagMatch) {
    const confidence = tagMatch[1].toLowerCase() as 'high' | 'partial' | 'low';
    const answer = rawAnswer.slice(0, tagMatch.index).trimEnd();
    return { answer, confidence };
  }

  // Fallback: use retrieval scores
  let confidence: 'high' | 'partial' | 'low';
  if (avgScore >= PARTIAL_CONFIDENCE_THRESHOLD) confidence = 'high';
  else if (avgScore >= LOW_CONFIDENCE_THRESHOLD) confidence = 'partial';
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

// Standard (non-streaming) query endpoint
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question: rawQuestion, collectionIds, conversationHistory, topK }: QueryRequest = req.body;
    const question = rawQuestion ? sanitizeInput(rawQuestion) : '';

    if (!question) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Check usage limit
    const usageCheck = await checkUsageLimit(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    const traceId = generateTraceId();
    const pipelineStart = Date.now();

    logger.info('Query received', { question, userId: req.user!.id, traceId });

    // Reformulate follow-up questions for better retrieval
    const searchQuery = await reformulateQuery(question, conversationHistory || []);

    const embeddingStart = Date.now();
    const queryEmbedding = await generateEmbedding(searchQuery);
    const embeddingTimeMs = Date.now() - embeddingStart;

    const retrievalStart = Date.now();
    const searchResults = await searchVectorStore(queryEmbedding, searchQuery, {
      topK: topK || 6,
      collectionIds,
    });
    const retrievalTimeMs = Date.now() - retrievalStart;

    if (searchResults.length === 0) {
      await recordQuery(req.user!.id);
      const responseTimeMs = Date.now() - pipelineStart;
      const response: QueryResponse = {
        answer:
          "This information is not covered in the current knowledge base documents. Please contact your supervisor or the relevant department for guidance, or try rephrasing your question.",
        sources: [],
        confidence: 'low',
        traceId,
      };
      // Log trace for zero-result queries too
      logRagTrace({
        traceId, timestamp: new Date().toISOString(),
        userId: req.user!.id, username: req.user!.username,
        queryText: question, reformulatedQuery: searchQuery !== question ? searchQuery : undefined,
        retrievedChunkIds: [], retrievalScores: [], avgRetrievalScore: 0,
        chunksPassedToModel: 0, modelId: BEDROCK_GENERATION_MODEL,
        responseText: response.answer, confidence: 'low',
        responseTimeMs, embeddingTimeMs, retrievalTimeMs,
        collectionIds, streamed: false,
      }).catch(() => {});
      res.json(response);
      return;
    }

    const context = buildContext(searchResults);
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
    const { answer, confidence } = parseConfidence(rawAnswer, avgScore);

    const sources = buildSourceCitations(searchResults);
    const responseTimeMs = Date.now() - pipelineStart;

    await recordQuery(req.user!.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question: redactPhi(question).text,
      sourcesUsed: sources.length,
      collectionIds,
      confidence,
      traceId,
    });

    // Log query for analytics / CSV export
    await logQuery(req.user!.id, req.user!.username, question, answer, confidence, sources, collectionIds);

    // Log RAG trace asynchronously (fire-and-forget)
    logRagTrace({
      traceId, timestamp: new Date().toISOString(),
      userId: req.user!.id, username: req.user!.username,
      queryText: question, reformulatedQuery: searchQuery !== question ? searchQuery : undefined,
      retrievedChunkIds: searchResults.map(r => r.chunk.id),
      retrievalScores: searchResults.map(r => r.score),
      avgRetrievalScore: avgScore,
      chunksPassedToModel: searchResults.length,
      modelId: BEDROCK_GENERATION_MODEL,
      responseText: answer, confidence,
      responseTimeMs, embeddingTimeMs, retrievalTimeMs, generationTimeMs,
      collectionIds, streamed: false,
      inputTokens, outputTokens,
    }).catch(() => {});

    const response: QueryResponse = { answer, sources, confidence, traceId };
    res.json(response);
  } catch (error) {
    logger.error('Query failed', { error: String(error) });
    res.status(500).json({ error: 'Query processing failed' });
  }
});

// Streaming query endpoint — sends answer tokens as Server-Sent Events
router.post('/stream', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question: rawQuestion, collectionIds, conversationHistory, topK }: QueryRequest = req.body;
    const question = rawQuestion ? sanitizeInput(rawQuestion) : '';

    if (!question) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Check usage limit before streaming
    const usageCheck = await checkUsageLimit(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    const traceId = generateTraceId();
    const pipelineStart = Date.now();

    logger.info('Streaming query received', { question, userId: req.user!.id, traceId });

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Reformulate follow-up questions for better retrieval
    const searchQuery = await reformulateQuery(question, conversationHistory || []);

    const embeddingStart = Date.now();
    const queryEmbedding = await generateEmbedding(searchQuery);
    const embeddingTimeMs = Date.now() - embeddingStart;

    const retrievalStart = Date.now();
    const searchResults = await searchVectorStore(queryEmbedding, searchQuery, {
      topK: topK || 6,
      collectionIds,
    });
    const retrievalTimeMs = Date.now() - retrievalStart;

    const avgScore = searchResults.length > 0
      ? searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length
      : 0;

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
      await recordQuery(req.user!.id);
      logRagTrace({
        traceId, timestamp: new Date().toISOString(),
        userId: req.user!.id, username: req.user!.username,
        queryText: question, reformulatedQuery: searchQuery !== question ? searchQuery : undefined,
        retrievedChunkIds: [], retrievalScores: [], avgRetrievalScore: 0,
        chunksPassedToModel: 0, modelId: BEDROCK_GENERATION_MODEL,
        responseText: noResultAnswer, confidence: 'low',
        responseTimeMs: Date.now() - pipelineStart, embeddingTimeMs, retrievalTimeMs,
        collectionIds, streamed: true,
      }).catch(() => {});
      return;
    }

    const context = buildContext(searchResults);
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
    const { confidence } = parseConfidence(fullAnswer, avgScore);
    res.write(`data: ${JSON.stringify({ type: 'confidence', confidence })}\n\n`);
    // Send traceId so frontend can link feedback to this trace
    res.write(`data: ${JSON.stringify({ type: 'traceId', traceId })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    const responseTimeMs = Date.now() - pipelineStart;

    // Record usage and audit (fire and forget)
    recordQuery(req.user!.id).catch(() => {});
    logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question: redactPhi(question).text,
      sourcesUsed: sources.length,
      collectionIds,
      confidence,
      streamed: true,
      traceId,
    }).catch(() => {});
    // Log query for analytics / CSV export
    const { answer: cleanAnswer } = parseConfidence(fullAnswer, avgScore);
    logQuery(req.user!.id, req.user!.username, question, cleanAnswer, confidence, sources, collectionIds).catch(() => {});
    // Log RAG trace (fire and forget)
    logRagTrace({
      traceId, timestamp: new Date().toISOString(),
      userId: req.user!.id, username: req.user!.username,
      queryText: question, reformulatedQuery: searchQuery !== question ? searchQuery : undefined,
      retrievedChunkIds: searchResults.map(r => r.chunk.id),
      retrievalScores: searchResults.map(r => r.score),
      avgRetrievalScore: avgScore,
      chunksPassedToModel: searchResults.length,
      modelId: BEDROCK_GENERATION_MODEL,
      responseText: cleanAnswer, confidence,
      responseTimeMs, embeddingTimeMs, retrievalTimeMs, generationTimeMs,
      collectionIds, streamed: true,
      inputTokens: streamInputTokens, outputTokens: streamOutputTokens,
    }).catch(() => {});
  } catch (error) {
    logger.error('Streaming query failed', { error: String(error) });
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Query processing failed' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Query processing failed' });
    }
  }
});

export default router;
