/**
 * Product Images Route
 *
 * Serves product images from S3. Images are stored under the
 * product-images/ prefix and served with cache headers.
 *
 * Also provides an admin upload endpoint for adding new product images.
 */

import { Router, Response } from 'express';
import multer from 'multer';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { s3Client, S3_BUCKET } from '../config/aws';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';

const router = Router();

const S3_PREFIX = 'product-images/';

// Multer for image uploads (5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

/**
 * GET /api/products/images/:filename — Serve a product image from S3.
 * Public within the app (authenticated users only).
 * Returns the image with 7-day cache headers.
 */
router.get('/images/:filename', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    // Sanitize filename — prevent path traversal
    const safe = filename.replace(/[^a-zA-Z0-9._\- ]/g, '');
    if (!safe || safe.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const key = `${S3_PREFIX}${safe}`;

    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));

    if (!result.Body) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Set content type and cache headers
    const contentType = result.ContentType || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    res.setHeader('Content-Disposition', 'inline');

    // Stream the body
    const body = await result.Body.transformToByteArray();
    res.send(Buffer.from(body));
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: 'Image not found' });
    } else {
      logger.error('Failed to serve product image', { error: String(error), filename: req.params.filename });
      res.status(500).json({ error: 'Failed to load image' });
    }
  }
});

/**
 * GET /api/products/images — List all available product images.
 */
router.get('/images', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: S3_PREFIX,
    }));

    const images = (result.Contents || [])
      .filter(obj => obj.Key && obj.Key !== S3_PREFIX)
      .map(obj => ({
        filename: obj.Key!.replace(S3_PREFIX, ''),
        url: `/api/products/images/${encodeURIComponent(obj.Key!.replace(S3_PREFIX, ''))}`,
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
      }));

    res.json({ images });
  } catch (error) {
    logger.error('Failed to list product images', { error: String(error) });
    res.status(500).json({ error: 'Failed to list images' });
  }
});

/**
 * POST /api/products/images — Upload a new product image (admin only).
 */
router.post('/images', authenticate, requireAdmin, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const filename = req.file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '');
    const key = `${S3_PREFIX}${filename}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const url = `/api/products/images/${encodeURIComponent(filename)}`;
    logger.info('Product image uploaded', { filename, size: req.file.size, uploadedBy: req.user!.username });

    res.status(201).json({ filename, url, size: req.file.size });
  } catch (error) {
    logger.error('Failed to upload product image', { error: String(error) });
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

export default router;
