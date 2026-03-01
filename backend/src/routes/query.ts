import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { generateEmbedding } from '../services/embeddings';
import { searchVectorStore } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { QueryRequest, QueryResponse, SourceCitation, ConversationTurn } from '../types';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const router = Router();

function buildPrompt(
  question: string,
  context: string,
  conversationHistory?: ConversationTurn[]
): string {
  let historyBlock = '';
  if (conversationHistory && conversationHistory.length > 0) {
    historyBlock = '\n\nPrevious conversation:\n';
    for (const turn of conversationHistory.slice(-5)) { // Keep last 5 turns
      historyBlock += `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}\n`;
    }
  }

  return `You are a knowledgeable assistant for UMS (a medical supply company). Answer the user's question based ONLY on the provided document context. If the context doesn't contain enough information to fully answer the question, say so clearly rather than making up information.

When referencing information, mention the source document name and page/section when available.

Document Context:
${context}
${historyBlock}
User Question: ${question}

Provide a clear, accurate answer based on the context above. If you cite specific information, note which document it comes from.`;
}

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, collectionIds, conversationHistory, topK }: QueryRequest = req.body;

    if (!question?.trim()) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    logger.info('Query received', { question, userId: req.user!.id });

    // Step 1: Generate query embedding
    const queryEmbedding = await generateEmbedding(question);

    // Step 2: Search vector store
    const searchResults = await searchVectorStore(queryEmbedding, question, {
      topK: topK || 5,
      collectionIds,
    });

    if (searchResults.length === 0) {
      const response: QueryResponse = {
        answer: 'I couldn\'t find any relevant documents to answer your question. Please make sure documents have been uploaded to the knowledge base, or try rephrasing your question.',
        sources: [],
      };
      res.json(response);
      return;
    }

    // Step 3: Build context from retrieved chunks
    const contextParts = searchResults.map((result, i) => {
      const pageInfo = result.chunk.pageNumber ? ` (Page ${result.chunk.pageNumber})` : '';
      return `[Source ${i + 1}: ${result.document.originalName}${pageInfo}]\n${result.chunk.text}`;
    });
    const context = contextParts.join('\n\n---\n\n');

    // Step 4: Generate answer via Bedrock Claude
    const prompt = buildPrompt(question, context, conversationHistory);

    const command = new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    const bedrockResponse = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const answer = responseBody.content?.[0]?.text || 'Unable to generate a response.';

    // Step 5: Build source citations
    const sources: SourceCitation[] = searchResults.map(result => ({
      documentId: result.document.id,
      documentName: result.document.originalName,
      chunkId: result.chunk.id,
      text: result.chunk.text,
      pageNumber: result.chunk.pageNumber,
      sectionHeader: result.chunk.sectionHeader,
      score: result.score,
    }));

    // Step 6: Audit log
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

export default router;
