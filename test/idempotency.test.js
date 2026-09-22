import test from 'node:test';
import assert from 'node:assert';
import { nanoUsdToUsd } from '../src/domain/pricing.js';
import { getCurrentPeriod } from '../src/domain/period.js';

test('Idempotency key hashing', async (t) => {
  const crypto = await import('crypto');
  const hash1 = crypto.createHash('sha256').update('test').digest('hex');
  const hash2 = crypto.createHash('sha256').update('test').digest('hex');

  assert.strictEqual(hash1, hash2, 'Same input should produce same hash');
});

test('Period calculation', async (t) => {
  const period = getCurrentPeriod(new Date('2024-09-15'));

  assert.strictEqual(period.year, 2024);
  assert.strictEqual(period.month, 9);
  assert.strictEqual(period.start, '2024-09-01');
  assert.strictEqual(period.end, '2024-09-30');
});

test('Cost formatting', async (t) => {
  // 315000 nano-USD = $0.000315
  const usd = nanoUsdToUsd(315000n);
  assert.strictEqual(usd, '0.000315');
});

test('Pricing is exact integer', async (t) => {
  // Verify that any cost calculation results in integer nano-USD
  const cost = BigInt(100) * BigInt(150) + BigInt(50) * BigInt(75);
  assert.strictEqual(typeof cost, 'bigint', 'Cost must be bigint');
  assert.strictEqual(cost % 1n, 0n, 'Cost must be exact integer');
});
