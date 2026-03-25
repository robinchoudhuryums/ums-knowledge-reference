import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_TEMPLATES,
  getTemplateById,
  listTemplates,
} from '../services/extractionTemplates';
import type { ExtractionTemplate, TemplateField } from '../services/extractionTemplates';

describe('extractionTemplates', () => {
  it('EXTRACTION_TEMPLATES has exactly 4 templates', () => {
    expect(EXTRACTION_TEMPLATES).toHaveLength(4);
  });

  it('all templates have required fields (id, name, description, category, fields, systemPrompt)', () => {
    for (const template of EXTRACTION_TEMPLATES) {
      expect(template.id).toBeDefined();
      expect(typeof template.id).toBe('string');
      expect(template.id.length).toBeGreaterThan(0);

      expect(template.name).toBeDefined();
      expect(typeof template.name).toBe('string');

      expect(template.description).toBeDefined();
      expect(typeof template.description).toBe('string');

      expect(template.category).toBeDefined();
      expect(['clinical', 'billing', 'compliance', 'general']).toContain(template.category);

      expect(Array.isArray(template.fields)).toBe(true);
      expect(template.fields.length).toBeGreaterThan(0);

      expect(template.systemPrompt).toBeDefined();
      expect(typeof template.systemPrompt).toBe('string');
    }
  });

  it('getTemplateById returns correct template for each known ID', () => {
    const knownIds = ['general', 'ppd', 'cmn', 'prior-auth'];
    for (const id of knownIds) {
      const template = getTemplateById(id);
      expect(template).toBeDefined();
      expect(template!.id).toBe(id);
    }
  });

  it('getTemplateById returns undefined for unknown ID', () => {
    expect(getTemplateById('nonexistent')).toBeUndefined();
    expect(getTemplateById('')).toBeUndefined();
    expect(getTemplateById('PPD')).toBeUndefined(); // case-sensitive
  });

  it('listTemplates returns metadata for all templates with fieldCount', () => {
    const list = listTemplates();
    expect(list).toHaveLength(EXTRACTION_TEMPLATES.length);

    for (const item of list) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('fieldCount');
      expect(typeof item.fieldCount).toBe('number');

      // fieldCount should match the actual template fields length
      const template = getTemplateById(item.id);
      expect(item.fieldCount).toBe(template!.fields.length);
    }

    // listTemplates should not include fields or systemPrompt
    for (const item of list) {
      expect(item).not.toHaveProperty('fields');
      expect(item).not.toHaveProperty('systemPrompt');
    }
  });

  it('every select field has options array defined', () => {
    for (const template of EXTRACTION_TEMPLATES) {
      const selectFields = template.fields.filter((f: TemplateField) => f.type === 'select');
      for (const field of selectFields) {
        expect(
          Array.isArray(field.options),
          `Template "${template.id}", field "${field.key}" is type "select" but has no options array`
        ).toBe(true);
        expect(
          field.options!.length,
          `Template "${template.id}", field "${field.key}" has empty options array`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('no duplicate field keys within any single template', () => {
    for (const template of EXTRACTION_TEMPLATES) {
      const keys = template.fields.map((f: TemplateField) => f.key);
      const uniqueKeys = new Set(keys);
      expect(
        uniqueKeys.size,
        `Template "${template.id}" has duplicate field keys`
      ).toBe(keys.length);
    }
  });

  it('all templates have non-empty systemPrompt', () => {
    for (const template of EXTRACTION_TEMPLATES) {
      expect(template.systemPrompt.trim().length).toBeGreaterThan(0);
      // System prompts should contain meaningful content (at least 50 chars)
      expect(template.systemPrompt.length).toBeGreaterThan(50);
    }
  });
});
