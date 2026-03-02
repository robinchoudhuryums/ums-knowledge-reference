import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { generateEmbedding } from '../services/embeddings';
import { searchVectorStore } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { QueryRequest, QueryResponse, SourceCitation, ConversationTurn, SearchResult } from '../types';
import { InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const router = Router();

const SYSTEM_PROMPT = `You are the UMS Knowledge Base Assistant — an expert reference tool for Universal Medical Supply, a medical supply company. Your role is to answer questions accurately using ONLY the provided document context.

Guidelines:
- Base every claim on the provided source documents. Cite sources inline using [Source N] notation.
- If the context does not contain enough information, say so clearly. Never fabricate information.
- When multiple sources agree, synthesize them. When they conflict, note the discrepancy.
- For procedural questions, provide step-by-step answers when the source material supports it.
- Use clear, professional language appropriate for a healthcare/medical supply workplace.
- Format responses with markdown: use **bold** for key terms, bullet lists for steps/items, and headers for multi-part answers.`;

function buildMessages(
  question: string,
  context: string,
  conversationHistory?: ConversationTurn[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Include last 5 conversation turns for follow-up context
  if (conversationHistory && conversationHistory.length > 0) {
    for (const turn of conversationHistory.slice(-5)) {
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

// Standard (non-streaming) query endpoint
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, collectionIds, conversationHistory, topK }: QueryRequest = req.body;

    if (!question?.trim()) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    logger.info('Query received', { question, userId: req.user!.id });

    const queryEmbedding = await generateEmbedding(question);

    const searchResults = await searchVectorStore(queryEmbedding, question, {
      topK: topK || 6,
      collectionIds,
    });

    if (searchResults.length === 0) {
      const response: QueryResponse = {
        answer:
          "I couldn't find any relevant documents to answer your question. Please make sure documents have been uploaded to the knowledge base, or try rephrasing your question.",
        sources: [],
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
    const answer = responseBody.content?.[0]?.text || 'Unable to generate a response.';

    const sources = buildSourceCitations(searchResults);

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question,
      sourcesUsed: sources.length,
      collectionIds,
    });

    const response: QueryResponse = { answer, sources };
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

    // Send sources first so the UI can display them immediately
    const sources = buildSourceCitations(searchResults);
    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

    if (searchResults.length === 0) {
      res.write(
        `data: ${JSON.stringify({ type: 'text', text: "I couldn't find any relevant documents to answer your question. Please make sure documents have been uploaded to the knowledge base, or try rephrasing your question." })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
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

    if (bedrockResponse.body) {
      for await (const event of bedrockResponse.body) {
        if (event.chunk?.bytes) {
          const parsed = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    // Audit log (fire and forget)
    logAuditEvent(req.user!.id, req.user!.username, 'query', {
      question,
      sourcesUsed: sources.length,
      collectionIds,
      streamed: true,
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
