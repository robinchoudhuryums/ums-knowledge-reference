import { MetadataStore } from './interfaces';
import { loadMetadata, saveMetadata, deleteMetadata } from '../services/s3Storage';

/**
 * S3-backed implementation of MetadataStore.
 * Delegates to the existing s3Storage helper functions which store JSON objects
 * under the S3 metadata prefix with AES-256 server-side encryption.
 */
export class S3MetadataStore implements MetadataStore {
  async load<T>(key: string): Promise<T | null> {
    return loadMetadata<T>(key);
  }

  async save<T>(key: string, data: T): Promise<void> {
    return saveMetadata<T>(key, data);
  }

  async delete(key: string): Promise<void> {
    return deleteMetadata(key);
  }
}
