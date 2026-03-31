/**
 * Custom OpenTelemetry span helpers for key RAG pipeline operations.
 *
 * Creates child spans for: embedding generation, vector search, LLM generation,
 * document ingestion, and other expensive operations. These appear as nested
 * spans under the HTTP request span in Jaeger/Tempo/etc.
 *
 * When OTEL_ENABLED is false, these are no-ops (zero overhead).
 */

import { trace, Span, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('ums-knowledge-base');

/**
 * Run an async function inside a named span.
 * Automatically records duration, sets error status on failure, and adds attributes.
 *
 * Usage:
 *   const result = await withSpan('bedrock.generate', { model: 'haiku' }, async (span) => {
 *     const res = await bedrockClient.send(command);
 *     span.setAttribute('tokens.input', res.usage.input_tokens);
 *     return res;
 *   });
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Add an event to the current active span (if any).
 * Useful for marking milestones within a span (e.g., "chunks retrieved", "confidence computed").
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current active span.
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }
}
