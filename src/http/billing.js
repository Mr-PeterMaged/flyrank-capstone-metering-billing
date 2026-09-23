import express from 'express';
import { getPool, withTransaction } from '../db/pool.js';
import * as stripeService from '../services/stripe.js';
import * as webhookRepo from '../repositories/webhook.js';
import * as tenantRepo from '../repositories/tenant.js';
import { extractApiKey, authenticateTenant } from './middleware.js';

export function setupBillingRoutes(app) {
  const pool = getPool();

  /**
   * POST /billing/checkout
   * Create a Stripe Checkout session to upgrade to Pro
   */
  app.post('/billing/checkout', extractApiKey, authenticateTenant, async (req, res, next) => {
    try {
      const tenant = req.tenant;

      const checkout = await withTransaction(async (db) => {
        return await stripeService.createCheckoutSession(db, tenant.id);
      });

      res.json({
        success: true,
        checkout: {
          session_id: checkout.session_id,
          url: checkout.url,
          customer_id: checkout.customer_id,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /webhooks/stripe
   * Stripe webhook handler
   * Signature-verified, idempotent processing
   */
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res, next) => {
    try {
      const signature = req.get('stripe-signature');
      if (!signature) {
        return res.status(400).json({ error: 'missing_signature' });
      }

      // Verify signature
      let event;
      try {
        event = stripeService.verifyWebhookSignature(req.body, signature);
      } catch (err) {
        return res.status(400).json({ error: 'signature_verification_failed' });
      }

      // Serialize duplicate deliveries and commit the event only with its effects.
      await withTransaction(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [event.id]);
        const existing = await webhookRepo.findByStripeEventId(db, event.id);
        if (existing) return;
        await stripeService.processWebhookEvent(db, event);
        await webhookRepo.recordWebhookEvent(db, event.id, event.type, 'processed', event.data);
      });

      res.json({ received: true });
    } catch (err) {
      console.error('❌ Webhook processing error:', err.message);
      // A failed transaction must be retried by Stripe, not acknowledged as delivered.
      res.status(503).json({ error: 'processing_failed' });
    }
  });

  return app;
}
