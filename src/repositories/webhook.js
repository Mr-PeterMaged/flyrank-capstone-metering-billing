export async function findByStripeEventId(db, eventId) {
  const result = await db.query(
    `SELECT * FROM webhook_events WHERE stripe_event_id = $1`,
    [eventId]
  );
  return result.rows[0] || null;
}

export async function recordWebhookEvent(db, eventId, type, outcome, data) {
  await db.query(
    `INSERT INTO webhook_events (stripe_event_id, type, outcome, data)
     VALUES ($1, $2, $3, $4)`,
    [eventId, type, outcome, JSON.stringify(data)]
  );
}

export async function getSubscription(db, tenantId) {
  const result = await db.query(
    `SELECT s.*, p.api_calls_limit, p.ai_tokens_limit
     FROM subscriptions s
     JOIN plans p ON s.plan_id = p.id
     WHERE s.tenant_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

export async function findSubscriptionByStripeId(db, stripeSubId) {
  const result = await db.query(
    `SELECT s.*, p.api_calls_limit, p.ai_tokens_limit
     FROM subscriptions s
     JOIN plans p ON s.plan_id = p.id
     WHERE s.stripe_subscription_id = $1`,
    [stripeSubId]
  );
  return result.rows[0] || null;
}

export async function createOrUpdateSubscription(db, {
  tenantId,
  stripeSubscriptionId,
  planId,
  status,
  currentPeriodStart,
  currentPeriodEnd,
  lastEventId,
  lastEventCreated,
}) {
  const result = await db.query(
    `INSERT INTO subscriptions (
      tenant_id, stripe_subscription_id, plan_id, status,
      current_period_start, current_period_end,
      last_event_id, last_event_created
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      plan_id = $3,
      status = $4,
      current_period_start = $5,
      current_period_end = $6,
      last_event_id = $7,
      last_event_created = $8,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      tenantId,
      stripeSubscriptionId,
      planId,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      lastEventId,
      lastEventCreated,
    ]
  );
  return result.rows[0];
}

export async function getPlanByName(db, planName) {
  const result = await db.query(
    `SELECT * FROM plans WHERE name = $1`,
    [planName]
  );
  return result.rows[0] || null;
}
