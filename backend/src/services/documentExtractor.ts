/**
 * Document Extractor Service
 *
 * Handles the pipeline: upload file → extract text → send to LLM with template prompt → return structured data.
 * Uses Sonnet for extraction (more accurate for structured form-filling) vs Haiku for RAG queries.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_EXTRACTION_MODEL } from '../config/aws';
import { getTemplateById, ExtractionTemplate } from './extractionTemplates';
import { extractText } from './textExtractor';
import { logger } from '../utils/logger';

export { BEDROCK_EXTRACTION_MODEL };

export interface ExtractionResult {
  templateId: string;
  templateName: string;
  data: Record<string, string | number | boolean | null>;
  confidence: 'high' | 'medium' | 'low';
  extractionNotes: string;
  modelUsed: string;
}

/**
 * Build the extraction prompt by combining the template system prompt with
 * a JSON schema of expected fields and the document text.
 */
function buildExtractionPrompt(template: ExtractionTemplate, documentText: string): { system: string; user: string } {
  const fieldSchema = template.fields.map(f => {
    let typeHint: string = f.type;
    if (f.type === 'select' && f.options) {
      typeHint = `one of: ${f.options.join(', ')}`;
    }
    return `  "${f.key}": ${f.required ? '(REQUIRED)' : '(optional)'} ${f.label} — type: ${typeHint}${f.description ? ` — ${f.description}` : ''}`;
  }).join('\n');

  const system = template.systemPrompt;

  const user = `Extract data from the following document and return a JSON object with these fields:

${fieldSchema}

IMPORTANT:
- Return ONLY a valid JSON object, no markdown fences, no commentary.
- Use null for fields not found in the document.
- For dates, use YYYY-MM-DD format.
- After the JSON object, on a new line, write "CONFIDENCE:" followed by "high", "medium", or "low" indicating how complete and reliable the extraction is.
- On another new line, write "NOTES:" followed by a brief note about extraction quality, missing data, or ambiguities.

DOCUMENT TEXT:
---
${documentText.substring(0, 80000)}
---

Extract the data now. Return ONLY the JSON followed by CONFIDENCE and NOTES lines.`;

  return { system, user };
}

/**
 * Parse the LLM response into structured data + confidence + notes.
 */
function parseExtractionResponse(
  response: string,
  template: ExtractionTemplate,
): { data: Record<string, string | number | boolean | null>; confidence: 'high' | 'medium' | 'low'; notes: string } {
  let jsonStr = response;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let notes = '';

  // Split off CONFIDENCE: and NOTES: lines
  const confidenceMatch = response.match(/\nCONFIDENCE:\s*(high|medium|low)/i);
  if (confidenceMatch) {
    confidence = confidenceMatch[1].toLowerCase() as 'high' | 'medium' | 'low';
    jsonStr = response.substring(0, confidenceMatch.index!);
  }

  const notesMatch = response.match(/\nNOTES:\s*(.+)/is);
  if (notesMatch) {
    notes = notesMatch[1].trim();
  }

  // Strip markdown fences if LLM included them despite instructions
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let data: Record<string, string | number | boolean | null>;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    // If JSON parsing fails, try to extract JSON from the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        data = JSON.parse(jsonMatch[0]);
      } catch {
        logger.error('Failed to parse extraction JSON', { response: response.substring(0, 500) });
        // Return empty data with all fields null
        data = {};
        template.fields.forEach(f => { data[f.key] = null; });
        confidence = 'low';
        notes = 'Failed to parse model response into structured data. Please review the raw text.';
      }
    } else {
      data = {};
      template.fields.forEach(f => { data[f.key] = null; });
      confidence = 'low';
      notes = 'Model did not return parseable JSON. Please review the raw text.';
    }
  }

  // Ensure all template fields exist in data
  for (const field of template.fields) {
    if (!(field.key in data)) {
      data[field.key] = null;
    }
  }

  return { data, confidence, notes };
}

/**
 * Main extraction function.
 *
 * @param fileBuffer - Raw file bytes
 * @param filename - Original filename
 * @param mimeType - MIME type
 * @param templateId - Which template to use
 */
export async function extractDocumentData(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  templateId: string,
): Promise<ExtractionResult> {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown extraction template: ${templateId}`);
  }

  logger.info('Starting document extraction', { filename, templateId, mimeType });

  // Step 1: Extract text from file
  const { text } = await extractText(fileBuffer, filename, mimeType);

  if (!text || text.trim().length < 20) {
    throw new Error('Could not extract sufficient text from the document. Try a higher-quality scan or a text-based PDF.');
  }

  logger.info('Text extracted for extraction', { filename, textLength: text.length });

  // Step 2: Build prompt
  const { system, user } = buildExtractionPrompt(template, text);

  // Step 3: Call Bedrock with Sonnet (more accurate for structured extraction)
  const command = new InvokeModelCommand({
    modelId: BEDROCK_EXTRACTION_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.05, // Very low — we want precise extraction
    }),
  });

  let responseText: string;
  try {
    const response = await bedrockClient.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    responseText = body.content?.[0]?.text || '';
  } catch (error: any) {
    logger.error('Bedrock extraction call failed', { error: error.message, templateId });
    throw new Error(`Extraction model call failed: ${error.message}`);
  }

  // Step 4: Parse response
  const { data, confidence, notes } = parseExtractionResponse(responseText, template);

  logger.info('Extraction complete', { filename, templateId, confidence, fieldsExtracted: Object.values(data).filter(v => v !== null).length });

  return {
    templateId: template.id,
    templateName: template.name,
    data,
    confidence,
    extractionNotes: notes,
    modelUsed: BEDROCK_EXTRACTION_MODEL,
  };
}
