import crypto from 'crypto';

export function hashRequest(body) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
}

export async function findByKey(db, tenantId, key) {
  const result = await db.query(
    `SELECT * FROM idempotency_keys
     WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key]
  );
  return result.rows[0] || null;
}

export async function store(db, tenantId, key, requestHash, responseStatus, responseBody) {
  await db.query(
    `INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, key, requestHash, responseStatus, JSON.stringify(responseBody)]
  );
}

/**
 * Validate request consistency for idempotency
 * Returns:
 *   null if key is new
 *   response if key exists with same request hash
 *   throws if key exists with different request hash (422 error)
 */
export async function validateIdempotencyKey(db, tenantId, key, requestHash) {
  const existing = await findByKey(db, tenantId, key);

  if (!existing) return null;

  if (existing.request_hash !== requestHash) {
    throw new Error('IDEMPOTENCY_KEY_REUSED');
  }

  return {
    status: existing.response_status,
    body: existing.response_body,
  };
}
