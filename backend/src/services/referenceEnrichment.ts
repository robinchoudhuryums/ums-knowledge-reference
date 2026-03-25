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

      // Include ICD-10 mappings if diagnosis keywords present
      if (ICD10_KEYWORDS.some(kw => questionLower.includes(kw))) {
        const mappings = getDiagnosesForHcpcs(code);
        if (mappings.length > 0) {
          lines.push(`\nICD-10 codes that justify ${code}:`);
          for (const m of mappings.slice(0, 15)) {
            lines.push(`  ${m.icd10Code}: ${m.coverageNotes || 'Covered'}`);
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
