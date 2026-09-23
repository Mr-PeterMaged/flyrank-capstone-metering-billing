import test from 'node:test';
import assert from 'node:assert/strict';

test('Stripe webhook uses signature authentication without requiring a tenant bearer token', async () => {
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_local_only';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_synthetic_local_only';
  const { createApp } = await import('../src/app.js');
  const { closePool } = await import('../src/db/pool.js');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/webhooks/stripe`;
    const unsigned = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unsigned.status, 400);
    assert.equal((await unsigned.json()).error, 'missing_signature');
    const forged = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 'forged' }, body: '{}' });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json()).error, 'signature_verification_failed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
});
