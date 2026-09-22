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

      // Process idempotently
      const result = await withTransaction(async (db) => {
        // Check if we've already processed this event
        const existing = await webhookRepo.findByStripeEventId(db, event.id);
        if (existing) {
          return { processed: true, existing };
        }

        // Record processing started
        await webhookRepo.recordWebhookEvent(db, event.id, event.type, 'processing', event.data);

        try {
          // Process the event
          await stripeService.processWebhookEvent(db, event);

          // Mark as successful
          await db.query(
            `UPDATE webhook_events
             SET outcome = 'processed'
             WHERE stripe_event_id = $1`,
            [event.id]
          );

          return { processed: false, success: true };
        } catch (err) {
          // Mark as failed - Stripe will retry
          await db.query(
            `UPDATE webhook_events
             SET outcome = 'failed'
             WHERE stripe_event_id = $1`,
            [event.id]
          );
          throw err;
        }
      });

      res.json({ received: true });
    } catch (err) {
      console.error('❌ Webhook processing error:', err.message);
      // Always return 200 to prevent Stripe retries for processing errors
      // The error is logged and can be investigated via webhook_events table
      res.status(200).json({ error: 'processing_failed', message: err.message });
    }
  });

  return app;
}
