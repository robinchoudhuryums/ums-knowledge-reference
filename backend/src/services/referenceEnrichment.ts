/**
 * Structured Reference Enrichment
 *
 * Detects when a user query involves HCPCS codes, ICD-10 codes, or
 * coverage/documentation questions, and pulls structured data from the
 * lookup services to inject into the RAG context alongside document chunks.
 */

import { searchHcpcs, getHcpcsCode } from './hcpcsLookup';
import { getHcpcsForDiagnosis, getDiagnosesForHcpcs, searchDiagnoses } from './icd10Mapping';
import { getChecklist, searchChecklists } from './coverageChecklists';

interface EnrichmentResult {
  /** Additional context text to prepend to the RAG document context */
  contextBlock: string;
  /** Label shown as a source citation */
  sourceLabel: string;
}

// Regex patterns for code detection
const HCPCS_PATTERN = /\b([ABCDEGHIJKLMPQRSTV]\d{4})\b/gi;
const ICD10_PATTERN = /\b([A-TV-Z]\d{2}(?:\.\d{1,4})?)\b/g;

// Keywords that suggest the user wants coverage/documentation info
const COVERAGE_KEYWORDS = [
  'coverage', 'criteria', 'qualify', 'qualification', 'requirements',
  'documentation', 'checklist', 'lcd', 'medical necessity',
  'prior auth', 'prior authorization', 'cmn', 'certificate of medical necessity',
  'face-to-face', 'face to face', 'compliance', 'covered', 'medicare covers',
];

// Keywords that suggest HCPCS lookup
const HCPCS_KEYWORDS = [
  'hcpcs', 'hcpc', 'billing code', 'procedure code', 'code for',
  'what code', 'which code',
];

// Keywords that suggest ICD-10 / diagnosis lookup
const ICD10_KEYWORDS = [
  'icd-10', 'icd10', 'icd 10', 'diagnosis code', 'diagnos',
  'what diagnosis', 'which diagnosis', 'justify', 'justifies',
];

/**
 * Analyze a query and return structured reference data if applicable.
 * Returns an array of enrichment blocks to inject into the LLM context.
 */
/**
 * Classify whether a query can be fully answered from structured reference data
 * without needing the full RAG pipeline (embedding → vector search → LLM).
 *
 * Returns 'structured' if the query is a pure code/crosswalk/checklist lookup,
 * 'hybrid' if it benefits from both structured data and document context,
 * or 'rag' if no structured data is relevant.
 *
 * Structured-only queries save ~2-4 seconds (no embedding, no vector search, no LLM call).
 */
export function classifyQuery(question: string): 'structured' | 'hybrid' | 'rag' {
  const lower = question.toLowerCase();

  // Detect explicit code references
  const hasHcpcsCode = HCPCS_PATTERN.test(question);
  HCPCS_PATTERN.lastIndex = 0; // reset regex state
  const hasIcd10Code = ICD10_PATTERN.test(question);
  ICD10_PATTERN.lastIndex = 0;
  const hasCodeKeywords = HCPCS_KEYWORDS.some(kw => lower.includes(kw)) ||
                          ICD10_KEYWORDS.some(kw => lower.includes(kw));
  const hasCoverageKeywords = COVERAGE_KEYWORDS.some(kw => lower.includes(kw));

  // Pure structured queries: asking specifically about a code, crosswalk, or checklist
  // These are short factual lookups that don't need document context.
  const structuredPatterns = [
    /^what\s+(?:is|are)\s+(?:hcpcs|hcpc|code)\s/i,
    /^(?:look\s*up|find|search|get)\s+(?:hcpcs|icd|code|diagnosis)/i,
    /^what\s+(?:hcpcs|billing|procedure)\s+codes?\s/i,
    /^what\s+(?:icd|diagnosis)\s+codes?\s/i,
    /^(?:hcpcs|icd-?10?)\s+(?:code\s+)?[A-Z]\d{2}/i,
    /^what\s+(?:are|is)\s+the\s+(?:coverage|documentation)\s+(?:criteria|requirements)\s+for\s+[A-Z]\d{4}/i,
  ];

  const isStructuredPattern = structuredPatterns.some(p => p.test(question));

  if (isStructuredPattern && (hasHcpcsCode || hasIcd10Code || hasCodeKeywords)) {
    return 'structured';
  }

  // Hybrid: has code references or coverage keywords, but also has contextual
  // elements that might benefit from document search
  if (hasHcpcsCode || hasIcd10Code || hasCodeKeywords || hasCoverageKeywords) {
    return 'hybrid';
  }

  return 'rag';
}

export function enrichQueryWithStructuredData(question: string): EnrichmentResult[] {
  const results: EnrichmentResult[] = [];
  const questionLower = question.toLowerCase();

  // 1. Detect explicit HCPCS codes in the query
  const hcpcsCodes = [...question.matchAll(HCPCS_PATTERN)].map(m => m[1].toUpperCase());
  const uniqueHcpcs = [...new Set(hcpcsCodes)];

  for (const code of uniqueHcpcs) {
    const hcpcs = getHcpcsCode(code);
    if (hcpcs) {
      const lines = [`HCPCS Code ${hcpcs.code}: ${hcpcs.shortDescription}`, `Category: ${hcpcs.category}`];
      if (hcpcs.longDescription !== hcpcs.shortDescription) {
        lines.push(`Description: ${hcpcs.longDescription}`);
      }

      // If coverage keywords present, include checklist
      if (COVERAGE_KEYWORDS.some(kw => questionLower.includes(kw))) {
        const checklist = getChecklist(code);
        if (checklist) {
          lines.push(`\nCoverage Checklist (${checklist.lcdNumber} — ${checklist.lcdTitle}):`);
          for (const item of checklist.checklist) {
            lines.push(`  ${item.required ? '[REQUIRED]' : '[OPTIONAL]'} ${item.description}`);
          }
          if (checklist.renewalChecklist?.length) {
            lines.push('Renewal requirements:');
            for (const item of checklist.renewalChecklist) {
              lines.push(`  ${item.required ? '[REQUIRED]' : '[OPTIONAL]'} ${item.description}`);
            }
          }
          if (checklist.generalCriteria?.length) {
            lines.push('General criteria: ' + checklist.generalCriteria.join('; '));
          }
          if (checklist.frequencyLimitations) {
            lines.push(`Frequency limitations: ${checklist.frequencyLimitations}`);
          }
        }
      }

      // Include ICD-10 mappings when asking about diagnoses, qualifications, or coverage
      const wantsDiagnoses = ICD10_KEYWORDS.some(kw => questionLower.includes(kw)) ||
        /qualif|justify|covered|eligible|what.*codes?/i.test(questionLower);
      if (wantsDiagnoses) {
        const mappings = getDiagnosesForHcpcs(code);
        if (mappings.length > 0) {
          lines.push(`\nICD-10 codes that justify ${code}:`);
          for (const m of mappings.slice(0, 15)) {
            let line = `  ${m.icd10Code}: ${m.coverageNotes || 'Covered'}`;
            if (m.documentationRequired) line += ` [Docs: ${m.documentationRequired}]`;
            lines.push(line);
          }
        }
      }

      results.push({ contextBlock: lines.join('\n'), sourceLabel: `HCPCS Reference: ${code}` });
    }
  }

  // 2. Detect explicit ICD-10 codes in the query
  const icd10Codes = [...question.matchAll(ICD10_PATTERN)].map(m => m[1].toUpperCase());
  const uniqueIcd10 = [...new Set(icd10Codes)].filter(code => {
    // Filter out codes that are actually HCPCS (start with E, B, K, etc. followed by 4 digits)
    return !/^[ABCDEGHIJKLMPQRSTV]\d{4}$/.test(code);
  });

  for (const code of uniqueIcd10) {
    const mappings = getHcpcsForDiagnosis(code);
    if (mappings.length > 0) {
      const lines = [`ICD-10 Code ${code} — DME Equipment Crosswalk:`];
      for (const m of mappings) {
        let line = `  ${m.hcpcsCode} (${m.hcpcsDescription})`;
        if (m.coverageNotes) line += ` — ${m.coverageNotes}`;
        if (m.documentationRequired) line += ` [Documentation: ${m.documentationRequired}]`;
        lines.push(line);
      }
      results.push({ contextBlock: lines.join('\n'), sourceLabel: `ICD-10 Crosswalk: ${code}` });
    }
  }

  // 3. Keyword-based HCPCS search (no explicit code, but asking about equipment)
  if (uniqueHcpcs.length === 0 && HCPCS_KEYWORDS.some(kw => questionLower.includes(kw))) {
    // Extract the equipment term by removing the keyword
    const searchTerm = questionLower
      .replace(/hcpcs|hcpc|billing code|procedure code|code for|what code|which code/gi, '')
      .trim();
    if (searchTerm.length >= 3) {
      const matches = searchHcpcs(searchTerm).slice(0, 10);
      if (matches.length > 0) {
        const lines = [`HCPCS Code Search Results for "${searchTerm}":`];
        for (const m of matches) {
          lines.push(`  ${m.code}: ${m.shortDescription} (${m.category})`);
        }
        results.push({ contextBlock: lines.join('\n'), sourceLabel: 'HCPCS Code Search' });
      }
    }
  }

  // 4. Keyword-based ICD-10 search
  if (uniqueIcd10.length === 0 && ICD10_KEYWORDS.some(kw => questionLower.includes(kw))) {
    const searchTerm = questionLower
      .replace(/icd-10|icd10|icd 10|diagnosis code|diagnos|what diagnosis|which diagnosis|justify|justifies/gi, '')
      .trim();
    if (searchTerm.length >= 3) {
      const matches = searchDiagnoses(searchTerm).slice(0, 10);
      if (matches.length > 0) {
        const lines = [`ICD-10 Diagnosis Search Results for "${searchTerm}":`];
        for (const m of matches) {
          lines.push(`  ${m.code}: ${m.description} (${m.category})`);
        }
        results.push({ contextBlock: lines.join('\n'), sourceLabel: 'ICD-10 Code Search' });
      }
    }
  }

  // 5. Coverage checklist search (no explicit HCPCS code but asking about coverage)
  if (uniqueHcpcs.length === 0 && COVERAGE_KEYWORDS.some(kw => questionLower.includes(kw))) {
    // Try to find relevant checklists by equipment name
    const equipmentTerms = questionLower
      .replace(/coverage|criteria|qualify|qualification|requirements|documentation|checklist|lcd|medical necessity|prior auth|prior authorization|cmn|certificate|face-to-face|face to face|compliance|covered|medicare covers|what|are|the|for|do|i|need|is|required/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (equipmentTerms.length >= 3) {
      const checklists = searchChecklists(equipmentTerms);
      if (checklists.length > 0) {
        // Include the top matching checklist
        const cl = checklists[0];
        const lines = [
          `Coverage Checklist for ${cl.hcpcsDescription} (${cl.hcpcsCode}) — ${cl.lcdNumber}: ${cl.lcdTitle}:`,
        ];
        for (const item of cl.checklist) {
          lines.push(`  ${item.required ? '[REQUIRED]' : '[OPTIONAL]'} ${item.description}`);
        }
        if (cl.renewalChecklist?.length) {
          lines.push('Renewal requirements:');
          for (const item of cl.renewalChecklist) {
            lines.push(`  ${item.required ? '[REQUIRED]' : '[OPTIONAL]'} ${item.description}`);
          }
        }
        if (cl.generalCriteria?.length) {
          lines.push('General criteria: ' + cl.generalCriteria.join('; '));
        }
        if (cl.frequencyLimitations) {
          lines.push(`Frequency limitations: ${cl.frequencyLimitations}`);
        }
        results.push({ contextBlock: lines.join('\n'), sourceLabel: `Coverage Checklist: ${cl.hcpcsCode}` });
      }
    }
  }

  return results;
}
