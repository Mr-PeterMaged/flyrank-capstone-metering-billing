/**
 * Usage event repository
 * All queries take a db handle so they can participate in transactions
 */

export async function recordUsageEvent(db, {
  tenantId,
  usageType,
  quantity,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
  costNanoUsd,
  idempotencyKey,
}) {
  const result = await db.query(
    `INSERT INTO usage_events (
      tenant_id, usage_type, quantity,
      input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
      cost_nano_usd, idempotency_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      tenantId,
      usageType,
      quantity,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      costNanoUsd,
      idempotencyKey,
    ]
  );
  return result.rows[0];
}

export async function findByIdempotencyKey(db, tenantId, key) {
  const result = await db.query(
    `SELECT * FROM usage_events
     WHERE tenant_id = $1 AND idempotency_key = $2
     LIMIT 1`,
    [tenantId, key]
  );
  return result.rows[0] || null;
}

export async function getMonthlyUsage(db, tenantId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // Last day of month
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(new Date(nextMonth).getTime() - 86400000)
    .toISOString()
    .split('T')[0];

  const result = await db.query(
    `SELECT
      usage_type,
      SUM(quantity)::BIGINT as total_quantity,
      SUM(cost_nano_usd)::BIGINT as total_cost,
      SUM(input_tokens)::BIGINT as total_input_tokens,
      SUM(cached_input_tokens)::BIGINT as total_cached_input_tokens,
      SUM(output_tokens)::BIGINT as total_output_tokens,
      SUM(reasoning_tokens)::BIGINT as total_reasoning_tokens,
      COUNT(*) as event_count
     FROM usage_events
     WHERE tenant_id = $1
       AND DATE(occurred_at) >= $2
       AND DATE(occurred_at) <= $3
     GROUP BY usage_type`,
    [tenantId, startDate, endDate]
  );

  return result.rows;
}

export async function getTotalMonthlyUsage(db, tenantId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(new Date(nextMonth).getTime() - 86400000)
    .toISOString()
    .split('T')[0];

  const result = await db.query(
    `SELECT
      SUM(quantity)::BIGINT as total_quantity,
      SUM(CASE WHEN usage_type = 'api_call' THEN quantity ELSE 0 END)::BIGINT as api_calls,
      SUM(CASE WHEN usage_type = 'ai_tokens' THEN quantity ELSE 0 END)::BIGINT as ai_tokens,
      SUM(cost_nano_usd)::BIGINT as total_cost,
      COUNT(*) as event_count
     FROM usage_events
     WHERE tenant_id = $1
       AND DATE(occurred_at) >= $2
       AND DATE(occurred_at) <= $3`,
    [tenantId, startDate, endDate]
  );

  return result.rows[0] || {
    total_quantity: 0n,
    api_calls: 0n,
    ai_tokens: 0n,
    total_cost: 0n,
    event_count: 0,
  };
}
