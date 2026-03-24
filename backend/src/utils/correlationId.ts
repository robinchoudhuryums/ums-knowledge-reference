import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationContext {
  correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStore.run({ correlationId: id }, fn);
}
