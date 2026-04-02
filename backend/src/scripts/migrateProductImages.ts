#!/usr/bin/env node
/**
 * Migrate product images from jsDelivr/GitHub CDN to S3.
 *
 * Downloads each unique product image and uploads it to the S3 bucket
 * under the product-images/ prefix. Run once after deployment.
 *
 * Usage:
 *   cd backend && env $(cat ../.env | grep -v '^#' | xargs) npx tsx src/scripts/migrateProductImages.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import https from 'https';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.S3_BUCKET || 'ums-knowledge-reference';
const S3_PREFIX = 'product-images/';
const region = process.env.AWS_REGION || 'us-east-1';

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// Map of clean filename → jsDelivr URL
const IMAGE_URLS: Record<string, string> = {
  'Pride Go-Go Ultra X 3-Wheel K0800.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Pride%20Go-Go%20Ultra%20X%203-Wheel%20K0800.jpg',
  'Pride Go-Go Sport 3-Wheel K0801.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Pride%20Go-Go%20Sport%203-Wheel%20K0801.jpg',
  'Pride Go Chair MED K0821.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Pride%20Go%20Chair%20MED%20K0821.jpg',
  'Jazzy Elite ES K0823.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Jazzy%20Elite%20ES%20K0823.jpg',
  'Jazzy Elite HD K0825.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/Jazzy%20Elite%20HD%20K0825.jpg',
  'Merits Atlantis K0827.png': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Merits%20Atlantis%20K0827.png',
  'Merits Vision Ultra HD K0837.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Merits%20Vision%20Ultra%20HD%20K0837.jpg',
  'Shoprider XLR-14 K0836_tilt.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@85319a5229adc0e586111c8ed5a28323b7821ce9/Shoprider%20XLR-14%20K0836_tilt.jpg',
  'Invacare TDX SP2 K0861.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/Invacare%20TDX%20SP2%20K0861.jpg',
  'Invacare TDX SP2 HD K0862.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/Invacare%20TDX%20SP2%20HD%20K0862.jpg',
  'Invacare TDX SP2 HD K0862_lifted.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/Invacare%20TDX%20SP2%20HD%20K0862_lifted.jpg',
  'Amysystems Alltrack HD3 K0863.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/Amysystems%20Alltrack%20HD3%20K0863.jpg',
  // Brochure images
  'K0800 Pride Ultra X Brochure (mfg).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0800%20Pride%20Ultra%20X%20Brochure%20(mfg).jpg',
  'K0801 - Pride Go-Go Sport Brochure (mfg).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0801%20-%20Pride%20Go-Go%20Sport%20Brochure%20(mfg).jpg',
  'K0821 Pride Go Chair Med Brochure (mfg).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0821%20Pride%20Go%20Chair%20Med%20Brochure%20(mfg).jpg',
  'K0823 Brochure (mfg).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0823%20Brochure%20(mfg).jpg',
  'K0825 Jazzy Elite HD Brochure (UMS).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0825%20Jazzy%20Elite%20HD%20Brochure%20(UMS).jpg',
  'K0827 Brochure (UMS).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0827%20Brochure%20(UMS).jpg',
  'K0836 UMS Brochure.png': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0836%20UMS%20Brochure.png',
  'K0837 Merits Vision Ultra HD Brochure (UMS).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0837%20Merits%20Vision%20Ultra%20HD%20Brochure%20(UMS).jpg',
  'K0858 - Invacare TDX SP 2 HD tilt only.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0858%20-%20Invacare%20TDX%20SP%202%20HD%20tilt%20only.jpg',
  'K0861 Brochure (UMS).jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0861%20Brochure%20(UMS).jpg',
  'K0862 UMS.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0862%20UMS.jpg',
  'K0863 AllTrack HD 3 AmyLior Brochure UMS.jpg': 'https://cdn.jsdelivr.net/gh/robinchoudhuryums/product-images@main/K0863%20AllTrack%20HD%203%20AmyLior%20Brochure%20UMS.jpg',
};

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log(`\nMigrating ${Object.keys(IMAGE_URLS).length} product images to S3...\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const [filename, url] of Object.entries(IMAGE_URLS)) {
    const key = `${S3_PREFIX}${filename}`;

    // Check if already exists
    try {
      await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      console.log(`  SKIP (exists): ${filename}`);
      skipped++;
      continue;
    } catch {
      // Doesn't exist — proceed to download + upload
    }

    try {
      const data = await downloadFile(url);
      const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
      }));

      console.log(`  OK: ${filename} (${(data.length / 1024).toFixed(0)} KB)`);
      uploaded++;
    } catch (err) {
      console.error(`  FAIL: ${filename} — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
