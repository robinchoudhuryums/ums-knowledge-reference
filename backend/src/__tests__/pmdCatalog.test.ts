import { describe, it, expect } from 'vitest';
import {
  PMD_CATALOG,
  getProductsByHcpcs,
  getProductByHcpcs,
} from '../services/pmdCatalog';

// ---------------------------------------------------------------------------
// PMD_CATALOG static data
// ---------------------------------------------------------------------------

describe('PMD_CATALOG', () => {
  it('has the expected number of products', () => {
    expect(PMD_CATALOG.length).toBe(21);
  });

  it('all products have required fields', () => {
    for (const product of PMD_CATALOG) {
      expect(product.hcpcs).toBeTruthy();
      expect(typeof product.hcpcs).toBe('string');
      expect(product.features).toBeTruthy();
      expect(typeof product.features).toBe('string');
      expect(product.weightCapacity).toBeTruthy();
      expect(typeof product.weightCapacity).toBe('string');
      expect(typeof product.seatType).toBe('string');
    }
  });

  it('all products have image and brochure URLs', () => {
    for (const product of PMD_CATALOG) {
      expect(product.imageUrl).toBeTruthy();
      expect(product.brochureUrl).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// getProductsByHcpcs
// ---------------------------------------------------------------------------

describe('getProductsByHcpcs', () => {
  it('returns products for a known HCPCS code', () => {
    const results = getProductsByHcpcs('K0800');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(p => {
      expect(p.hcpcs).toBe('K0800');
    });
  });

  it('returns multiple products when code has variants', () => {
    // K0823 and K0825 appear in the catalog
    const results = getProductsByHcpcs('K0823');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for unknown code', () => {
    expect(getProductsByHcpcs('Z9999')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getProductByHcpcs
// ---------------------------------------------------------------------------

describe('getProductByHcpcs', () => {
  it('returns the first matching product', () => {
    const product = getProductByHcpcs('K0800');
    expect(product).toBeDefined();
    expect(product!.hcpcs).toBe('K0800');
  });

  it('returns undefined for unknown code', () => {
    expect(getProductByHcpcs('Z9999')).toBeUndefined();
  });

  it('returned product has all expected fields', () => {
    const product = getProductByHcpcs('K0861');
    expect(product).toBeDefined();
    expect(product!.features).toBeTruthy();
    expect(product!.weightCapacity).toBeTruthy();
    expect(typeof product!.seatType).toBe('string');
    expect(typeof product!.portable).toBe('boolean');
    expect(typeof product!.foldable).toBe('boolean');
    expect(typeof product!.seatDimensions).toBe('string');
    expect(typeof product!.colors).toBe('string');
    expect(typeof product!.leadTime).toBe('string');
    expect(typeof product!.notes).toBe('string');
  });
});
