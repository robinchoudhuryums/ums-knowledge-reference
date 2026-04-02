/**
 * Product Image Resolver
 *
 * Maps HCPCS codes and product names to product images.
 * Used by the RAG pipeline to attach relevant product images to responses.
 *
 * Sources:
 * 1. PMD catalog (static — 22 products with images)
 * 2. S3 product-images/ prefix (dynamic — admin-uploaded images)
 *
 * Images are matched by HCPCS code in filename or catalog reference.
 */

import { PMD_CATALOG, PmdProduct } from './pmdCatalog';

export interface ProductImageMatch {
  hcpcsCode: string;
  productName: string;
  imageUrl: string;
  brochureUrl?: string;
}

// Build a map of HCPCS code → product for fast lookup
const hcpcsToProduct = new Map<string, PmdProduct>();
for (const product of PMD_CATALOG) {
  // Some products share HCPCS codes — keep the first one
  if (!hcpcsToProduct.has(product.hcpcs)) {
    hcpcsToProduct.set(product.hcpcs, product);
  }
}

// HCPCS code pattern
const HCPCS_PATTERN = /\b([ABCDEGHIJKLMPQRSTV]\d{4})\b/gi;

/**
 * Find product images relevant to a text (RAG response or query).
 * Scans for HCPCS codes and returns matching product images.
 */
export function findProductImages(text: string): ProductImageMatch[] {
  const matches: ProductImageMatch[] = [];
  const seen = new Set<string>();

  // Find all HCPCS codes in the text
  const codes = [...text.matchAll(HCPCS_PATTERN)].map(m => m[1].toUpperCase());

  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);

    const product = hcpcsToProduct.get(code);
    if (product && product.imageUrl) {
      matches.push({
        hcpcsCode: code,
        productName: product.features,
        imageUrl: product.imageUrl,
        brochureUrl: product.brochureUrl || undefined,
      });
    }
  }

  return matches;
}

/**
 * Get product image for a specific HCPCS code.
 */
export function getProductImage(hcpcsCode: string): ProductImageMatch | null {
  const product = hcpcsToProduct.get(hcpcsCode.toUpperCase());
  if (!product || !product.imageUrl) return null;
  return {
    hcpcsCode: hcpcsCode.toUpperCase(),
    productName: product.features,
    imageUrl: product.imageUrl,
    brochureUrl: product.brochureUrl || undefined,
  };
}
