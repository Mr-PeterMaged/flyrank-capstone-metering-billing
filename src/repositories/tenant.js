import crypto from 'crypto';

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function findByApiKey(db, apiKeyHash) {
  const result = await db.query(
    `SELECT t.*, p.api_calls_limit, p.ai_tokens_limit
     FROM tenants t
     JOIN plans p ON t.plan_id = p.id
     WHERE t.api_key_hash = $1`,
    [apiKeyHash]
  );
  return result.rows[0] || null;
}

export async function findById(db, id) {
  const result = await db.query(
    `SELECT t.*, p.api_calls_limit, p.ai_tokens_limit
     FROM tenants t
     JOIN plans p ON t.plan_id = p.id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function updatePlan(db, tenantId, planId, billingStatus) {
  const result = await db.query(
    `UPDATE tenants
     SET plan_id = $2, billing_status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [tenantId, planId, billingStatus]
  );
  return result.rows[0] || null;
}

export async function updateBillingStatus(db, tenantId, status) {
  const result = await db.query(
    `UPDATE tenants
     SET billing_status = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [tenantId, status]
  );
  return result.rows[0] || null;
}

export async function findByStripeCustomerId(db, customerId) {
  const result = await db.query(
    `SELECT t.*, p.api_calls_limit, p.ai_tokens_limit
     FROM tenants t
     JOIN plans p ON t.plan_id = p.id
     WHERE t.stripe_customer_id = $1`,
    [customerId]
  );
  return result.rows[0] || null;
}

export async function setStripeCustomerId(db, tenantId, customerId) {
  const result = await db.query(
    `UPDATE tenants
     SET stripe_customer_id = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [tenantId, customerId]
  );
  return result.rows[0] || null;
}
