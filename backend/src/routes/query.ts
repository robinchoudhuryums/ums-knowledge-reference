import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { generateEmbedding } from '../services/embeddings';
import { searchVectorStore } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { checkUsageLimit, recordQuery } from '../services/usage';
import { logQuery } from '../services/queryLog';
import { QueryRequest, QueryResponse, SourceCitation, ConversationTurn, SearchResult } from '../types';
import { InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const router = Router();

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

// Standard (non-streaming) query endpoint
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, collectionIds, conversationHistory, topK }: QueryRequest = req.body;

    if (!question?.trim()) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Check usage limit
    const usageCheck = await checkUsageLimit(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    logger.info('Query received', { question, userId: req.user!.id });

    const queryEmbedding = await generateEmbedding(question);

    const searchResults = await searchVectorStore(queryEmbedding, question, {
      topK: topK || 6,
      collectionIds,
    });

    if (searchResults.length === 0) {
      await recordQuery(req.user!.id);
      const response: QueryResponse = {
        answer:
          "This information is not covered in the current knowledge base documents. Please contact your supervisor or the relevant department for guidance, or try rephrasing your question.",
        sources: [],
        confidence: 'low',
      };
      res.json(response);
      return;
    }

    const context = buildContext(searchResults);
    const messages = buildMessages(question, context, conversationHistory);

    const command = new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        temperature: 0.15,
      }),
    });

    const bedrockResponse = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const rawAnswer = responseBody.content?.[0]?.text || 'Unable to generate a response.';

    const avgScore = searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
    const { answer, confidence } = parseConfidence(rawAnswer, avgScore);

    const sources = buildSourceCitations(searchResults);

    await recordQuery(req.user!.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question,
      sourcesUsed: sources.length,
      collectionIds,
      confidence,
    });

    // Log query for analytics / CSV export
    await logQuery(req.user!.id, req.user!.username, question, answer, confidence, sources, collectionIds);

    const response: QueryResponse = { answer, sources, confidence };
    res.json(response);
  } catch (error) {
    logger.error('Query failed', { error: String(error) });
    res.status(500).json({ error: 'Query processing failed' });
  }
});

// Streaming query endpoint — sends answer tokens as Server-Sent Events
router.post('/stream', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, collectionIds, conversationHistory, topK }: QueryRequest = req.body;

    if (!question?.trim()) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Check usage limit before streaming
    const usageCheck = await checkUsageLimit(req.user!.id);
    if (!usageCheck.allowed) {
      res.status(429).json({ error: usageCheck.reason, usage: usageCheck.usage });
      return;
    }

    logger.info('Streaming query received', { question, userId: req.user!.id });

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const queryEmbedding = await generateEmbedding(question);

    const searchResults = await searchVectorStore(queryEmbedding, question, {
      topK: topK || 6,
      collectionIds,
    });

    const avgScore = searchResults.length > 0
      ? searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length
      : 0;

    // Send sources and initial confidence hint
    const sources = buildSourceCitations(searchResults);
    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

    if (searchResults.length === 0) {
      res.write(
        `data: ${JSON.stringify({ type: 'text', text: "This information is not covered in the current knowledge base documents. Please contact your supervisor or the relevant department for guidance, or try rephrasing your question." })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'confidence', confidence: 'low' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      await recordQuery(req.user!.id);
      return;
    }

    const context = buildContext(searchResults);
    const messages = buildMessages(question, context, conversationHistory);

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        temperature: 0.15,
      }),
    });

    const bedrockResponse = await bedrockClient.send(command);

    let fullAnswer = '';
    if (bedrockResponse.body) {
      for await (const event of bedrockResponse.body) {
        if (event.chunk?.bytes) {
          const parsed = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullAnswer += parsed.delta.text;
            res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
          }
        }
      }
    }

    // Parse confidence from the completed answer
    const { confidence } = parseConfidence(fullAnswer, avgScore);
    res.write(`data: ${JSON.stringify({ type: 'confidence', confidence })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    // Record usage and audit (fire and forget)
    recordQuery(req.user!.id).catch(() => {});
    logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question,
      sourcesUsed: sources.length,
      collectionIds,
      confidence,
      streamed: true,
    }).catch(() => {});
    // Log query for analytics / CSV export
    const { answer: cleanAnswer } = parseConfidence(fullAnswer, avgScore);
    logQuery(req.user!.id, req.user!.username, question, cleanAnswer, confidence, sources, collectionIds).catch(() => {});
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
