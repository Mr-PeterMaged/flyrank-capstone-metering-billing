/**
 * Stripe integration service
 * Handles Checkout, webhooks, and subscription sync
 */

import Stripe from 'stripe';
import * as tenantRepo from '../repositories/tenant.js';
import * as webhookRepo from '../repositories/webhook.js';
import { config } from '../config/index.js';

const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2024-11-20',
});

/**
 * Create a Checkout session for upgrading to Pro
 */
export async function createCheckoutSession(db, tenantId) {
  const tenant = await tenantRepo.findById(db, tenantId);
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  // Get or create Stripe customer
  let customerId = tenant.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: {
        tenant_id: tenantId.toString(),
        tenant_name: tenant.name,
      },
    });
    customerId = customer.id;
    await tenantRepo.setStripeCustomerId(db, tenantId, customerId);
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price: config.stripe.pricePro,
        quantity: 1,
      },
    ],
    success_url: config.stripe.checkoutSuccessUrl,
    cancel_url: config.stripe.checkoutCancelUrl,
  });

  return {
    session_id: session.id,
    url: session.url,
    customer_id: customerId,
  };
}

/**
 * Verify webhook signature and extract event
 */
export function verifyWebhookSignature(rawBody, signature) {
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhookSecret
    );
  } catch (err) {
    throw new Error('WEBHOOK_VERIFICATION_FAILED');
  }
}

/**
 * Handle checkout.session.completed event
 */
export async function handleCheckoutSessionCompleted(db, event, eventData) {
  const session = eventData.object;
  const customerId = session.customer;

  // Find tenant by Stripe customer ID
  const tenant = await tenantRepo.findByStripeCustomerId(db, customerId);
  if (!tenant) {
    console.warn(`⚠️ Webhook: customer ${customerId} not found`);
    return;
  }

  // Get Pro plan
  const proPlan = await webhookRepo.getPlanByName(db, 'Pro');
  if (!proPlan) throw new Error('PRO_PLAN_NOT_FOUND');

  // Subscriptions are created when the payment succeeds
  // We'll handle them in customer.subscription.updated
  console.log(`✅ Checkout completed for tenant ${tenant.id}`);
}

/**
 * Handle customer.subscription.updated event
 */
export async function handleSubscriptionUpdated(db, event, eventData) {
  const subscription = eventData.object;
  const customerId = subscription.customer;

  // Find tenant
  const tenant = await tenantRepo.findByStripeCustomerId(db, customerId);
  if (!tenant) {
    console.warn(`⚠️ Webhook: customer ${customerId} not found`);
    return;
  }

  // Map Stripe status to our status
  const statusMap = {
    'active': 'active',
    'past_due': 'past_due',
    'unpaid': 'unpaid',
    'canceled': 'canceled',
  };

  const subStatus = statusMap[subscription.status] || 'unpaid';

  // Determine plan from price
  let planName = 'Free';
  if (subscription.items?.data?.[0]?.price?.id === config.stripe.pricePro) {
    planName = 'Pro';
  }

  const plan = await webhookRepo.getPlanByName(db, planName);
  if (!plan) throw new Error('PLAN_NOT_FOUND');

  // Create or update subscription
  const currentDate = new Date();
  const periodStart = new Date(subscription.current_period_start * 1000)
    .toISOString()
    .split('T')[0];
  const periodEnd = new Date(subscription.current_period_end * 1000)
    .toISOString()
    .split('T')[0];

  await webhookRepo.createOrUpdateSubscription(db, {
    tenantId: tenant.id,
    stripeSubscriptionId: subscription.id,
    planId: plan.id,
    status: subStatus,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    lastEventId: event.id,
    lastEventCreated: new Date(event.created * 1000),
  });

  // Update tenant's billing status
  await tenantRepo.updatePlan(db, tenant.id, plan.id, subStatus);

  console.log(`✅ Subscription updated for tenant ${tenant.id}: ${planName} (${subStatus})`);
}

/**
 * Handle customer.subscription.deleted event
 */
export async function handleSubscriptionDeleted(db, event, eventData) {
  const subscription = eventData.object;
  const customerId = subscription.customer;

  // Find tenant
  const tenant = await tenantRepo.findByStripeCustomerId(db, customerId);
  if (!tenant) {
    console.warn(`⚠️ Webhook: customer ${customerId} not found`);
    return;
  }

  // Downgrade to Free
  const freePlan = await webhookRepo.getPlanByName(db, 'Free');
  if (!freePlan) throw new Error('FREE_PLAN_NOT_FOUND');

  await tenantRepo.updatePlan(db, tenant.id, freePlan.id, 'active');

  // Mark subscription as deleted
  await webhookRepo.createOrUpdateSubscription(db, {
    tenantId: tenant.id,
    stripeSubscriptionId: subscription.id,
    planId: freePlan.id,
    status: 'canceled',
    currentPeriodStart: new Date().toISOString().split('T')[0],
    currentPeriodEnd: new Date().toISOString().split('T')[0],
    lastEventId: event.id,
    lastEventCreated: new Date(event.created * 1000),
  });

  console.log(`✅ Subscription deleted for tenant ${tenant.id}: downgraded to Free`);
}

/**
 * Process webhook event
 */
export async function processWebhookEvent(db, event) {
  const eventHandlers = {
    'checkout.session.completed': handleCheckoutSessionCompleted,
    'customer.subscription.updated': handleSubscriptionUpdated,
    'customer.subscription.deleted': handleSubscriptionDeleted,
  };

  const handler = eventHandlers[event.type];
  if (handler) {
    await handler(db, event, event.data);
  } else {
    console.log(`⚠️ Unhandled webhook event type: ${event.type}`);
  }
}
