import { DocumentStore } from './interfaces';
import {
  uploadDocumentToS3,
  getDocumentFromS3,
  deleteDocumentFromS3,
  getDocumentETag,
} from '../services/s3Storage';

/**
 * S3-backed implementation of DocumentStore.
 * Delegates to the existing s3Storage helper functions which use the AWS SDK
 * Upload (multipart) for writes and GetObject/HeadObject for reads.
 */
export class S3DocumentStore implements DocumentStore {
  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    return uploadDocumentToS3(buffer, key, contentType);
  }

  async download(key: string): Promise<Buffer> {
    return getDocumentFromS3(key);
  }

  async delete(key: string): Promise<void> {
    return deleteDocumentFromS3(key);
  }

  async getETag(key: string): Promise<string | null> {
    return getDocumentETag(key);
  }
}
