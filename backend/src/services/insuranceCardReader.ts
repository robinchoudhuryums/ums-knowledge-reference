/**
 * Insurance Card Reader
 *
 * Takes an image of an insurance card, runs it through AWS Textract OCR,
 * then uses Claude to extract structured insurance fields from the raw text.
 * Returns fields that can auto-fill account creation forms.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { extractTextWithOcr } from './ocr';
import { logger } from '../utils/logger';

export interface InsuranceCardFields {
  insuranceName: string | null;
  memberId: string | null;
  groupNumber: string | null;
  planType: string | null;
  subscriberName: string | null;
  subscriberDob: string | null;
  effectiveDate: string | null;
  copay: string | null;
  rxBin: string | null;
  rxPcn: string | null;
  payerId: string | null;
  phoneNumber: string | null;
  address: string | null;
  rawText: string;
}

const EXTRACTION_PROMPT = `You are an insurance card data extraction specialist. Extract the following fields from the OCR text of an insurance card image. Return ONLY valid JSON with these fields:

{
  "insuranceName": "The insurance company name (e.g., Aetna, UnitedHealthcare, BCBS, Humana, Medicare, Medicaid)",
  "memberId": "The member/subscriber ID number",
  "groupNumber": "The group number if present",
  "planType": "The plan type (e.g., HMO, PPO, Medicare Part B, Medicaid)",
  "subscriberName": "The subscriber/member name if visible",
  "subscriberDob": "Date of birth if visible (YYYY-MM-DD format)",
  "effectiveDate": "Effective/start date if visible (YYYY-MM-DD)",
  "copay": "Copay amounts if listed",
  "rxBin": "Rx BIN number if present",
  "rxPcn": "Rx PCN number if present",
  "payerId": "Payer ID if present",
  "phoneNumber": "Member services phone number if visible",
  "address": "Insurance company address if visible"
}

Rules:
- Return null for any field not found in the text.
- Be precise with ID numbers — copy exactly as shown.
- If the card shows both front and back, extract from both sides.
- Do not guess or fabricate any information.`;

export async function readInsuranceCard(imageBuffer: Buffer, filename: string): Promise<InsuranceCardFields> {
  // Step 1: OCR the image
  logger.info('Insurance card OCR starting', { filename, sizeBytes: imageBuffer.length });

  let ocrResult;
  try {
    ocrResult = await extractTextWithOcr(imageBuffer, filename);
  } catch (err) {
    logger.error('Insurance card OCR failed', { error: String(err) });
    throw new Error('Failed to read text from insurance card image');
  }
  const rawText = ocrResult.text;

  if (rawText.trim().length < 10) {
    throw new Error('Could not extract sufficient text from the image. Please ensure the insurance card is clearly visible.');
  }

  logger.info('Insurance card OCR complete', { textLength: rawText.length });

  // Step 2: Use Claude to extract structured fields
  try {
    const command = new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        temperature: 0.05,
        system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Here is the OCR text from an insurance card:\n\n${rawText}` }],
      }),
    });

    const response = await bedrockClient.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    const responseText = body.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Insurance card extraction: no JSON in response');
      return { ...emptyFields(), rawText };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      insuranceName: parsed.insuranceName || null,
      memberId: parsed.memberId || null,
      groupNumber: parsed.groupNumber || null,
      planType: parsed.planType || null,
      subscriberName: parsed.subscriberName || null,
      subscriberDob: parsed.subscriberDob || null,
      effectiveDate: parsed.effectiveDate || null,
      copay: parsed.copay || null,
      rxBin: parsed.rxBin || null,
      rxPcn: parsed.rxPcn || null,
      payerId: parsed.payerId || null,
      phoneNumber: parsed.phoneNumber || null,
      address: parsed.address || null,
      rawText,
    };
  } catch (err) {
    logger.error('Insurance card field extraction failed', { error: String(err) });
    return { ...emptyFields(), rawText };
  }
}

function emptyFields(): Omit<InsuranceCardFields, 'rawText'> {
  return {
    insuranceName: null, memberId: null, groupNumber: null, planType: null,
    subscriberName: null, subscriberDob: null, effectiveDate: null,
    copay: null, rxBin: null, rxPcn: null, payerId: null,
    phoneNumber: null, address: null,
  };
}

/**
 * Compare OCR-extracted fields against manually entered data.
 * Returns mismatches for agent review.
 */
export function compareInsuranceFields(
  extracted: InsuranceCardFields,
  entered: { insuranceName?: string; memberId?: string; subscriberName?: string; dob?: string },
): Array<{ field: string; extracted: string; entered: string }> {
  const mismatches: Array<{ field: string; extracted: string; entered: string }> = [];

  const normalize = (s: string | null | undefined): string => (s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  if (extracted.insuranceName && entered.insuranceName) {
    if (!normalize(entered.insuranceName).includes(normalize(extracted.insuranceName)) &&
        !normalize(extracted.insuranceName).includes(normalize(entered.insuranceName))) {
      mismatches.push({ field: 'Insurance Name', extracted: extracted.insuranceName, entered: entered.insuranceName });
    }
  }

  if (extracted.memberId && entered.memberId) {
    if (normalize(extracted.memberId) !== normalize(entered.memberId)) {
      mismatches.push({ field: 'Member ID', extracted: extracted.memberId, entered: entered.memberId });
    }
  }

  if (extracted.subscriberName && entered.subscriberName) {
    if (!normalize(entered.subscriberName).includes(normalize(extracted.subscriberName)) &&
        !normalize(extracted.subscriberName).includes(normalize(entered.subscriberName))) {
      mismatches.push({ field: 'Subscriber Name', extracted: extracted.subscriberName, entered: entered.subscriberName });
    }
  }

  if (extracted.subscriberDob && entered.dob) {
    if (normalize(extracted.subscriberDob) !== normalize(entered.dob)) {
      mismatches.push({ field: 'Date of Birth', extracted: extracted.subscriberDob, entered: entered.dob });
    }
  }

  return mismatches;
}
