import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const VISION_PROMPT = `Examine this document and describe ONLY the visual elements — images, photos, diagrams, charts, graphs, tables shown as images, logos, and illustrations. For each visual element:
- Describe what it shows in detail (subject, labels, data, layout)
- Note the page number or location if apparent
- Include any text/labels visible within the visual element

If there are NO visual elements (images, photos, diagrams, charts) in the document, respond with exactly: NO_VISUAL_ELEMENTS

Do NOT describe or repeat regular text content — only visual elements.`;

/**
 * Send a PDF to Claude Haiku via Bedrock Converse API to describe images/diagrams.
 * Returns descriptive text for all visual elements found, or empty string if none.
 */
export async function extractImageDescriptions(
  pdfBuffer: Buffer,
  filename: string
): Promise<string> {
  try {
    logger.info('Vision extraction: analyzing PDF for visual elements', {
      filename,
      sizeBytes: pdfBuffer.length,
    });

    // Bedrock Converse API document limit is 4.5MB
    if (pdfBuffer.length > 4.5 * 1024 * 1024) {
      logger.warn('Vision extraction: PDF too large for Converse API, skipping', {
        filename,
        sizeBytes: pdfBuffer.length,
      });
      return '';
    }

    const command = new ConverseCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              document: {
                format: 'pdf',
                name: filename.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 200),
                source: {
                  bytes: pdfBuffer,
                },
              },
            },
            {
              text: VISION_PROMPT,
            },
          ],
        },
      ],
      system: [
        {
          text: 'You are a document analysis assistant. Your job is to describe visual elements in documents accurately and concisely.',
        },
      ],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.1,
      },
    });

    const response = await bedrockClient.send(command);

    const outputText =
      response.output?.message?.content
        ?.map(block => ('text' in block ? block.text : ''))
        .join('\n')
        .trim() || '';

    // If the model found no visual elements, return empty
    if (outputText === 'NO_VISUAL_ELEMENTS' || outputText.includes('NO_VISUAL_ELEMENTS')) {
      logger.info('Vision extraction: no visual elements found', { filename });
      return '';
    }

    logger.info('Vision extraction: described visual elements', {
      filename,
      descriptionLength: outputText.length,
    });

    // Wrap the descriptions so the chunker can identify them as image descriptions
    return `\n\n--- Image and Visual Element Descriptions ---\n${outputText}\n--- End Visual Descriptions ---\n`;
  } catch (error) {
    // Vision extraction is optional — log and continue without it
    logger.warn('Vision extraction failed, continuing without image descriptions', {
      filename,
      error: String(error),
    });
    return '';
  }
}
