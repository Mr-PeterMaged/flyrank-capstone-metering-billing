import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('signed webhook commits once, serializes duplicates, and rejects altered bytes', {
  skip: !process.env.WEBHOOK_TEST_DATABASE_URL && 'Set WEBHOOK_TEST_DATABASE_URL to an isolated migrated PostgreSQL database',
}, async () => {
  process.env.NODE_ENV = 'test';
  process.env.TEST_DATABASE_URL = process.env.WEBHOOK_TEST_DATABASE_URL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_local_only';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_synthetic_local_only';
  const { default: Stripe } = await import('stripe');
  const { createApp } = await import('../src/app.js');
  const { getPool, closePool } = await import('../src/db/pool.js');
  const eventId = `evt_test_${randomUUID()}`;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const payload = JSON.stringify({ id: eventId, type: 'test.deployment', created: Math.floor(Date.now() / 1000), data: { object: {} } });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const url = `http://127.0.0.1:${server.address().port}/webhooks/stripe`;
    const send = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body });
    const responses = await Promise.all([send(payload), send(payload), send(payload)]);
    for (const response of responses) assert.equal(response.status, 200, await response.text());
    const result = await getPool().query('SELECT outcome FROM webhook_events WHERE stripe_event_id=$1', [eventId]);
    assert.deepEqual(result.rows, [{ outcome: 'processed' }]);
    assert.equal((await send(payload + ' ')).status, 400);
  } finally {
    await getPool().query('DELETE FROM webhook_events WHERE stripe_event_id=$1', [eventId]);
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
});
