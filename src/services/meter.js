/**
 * MeterService - Records usage events idempotently
 *
 * The heart of the system: guarantee exactly-once metering even under retries.
 * Uses database-level locking to make this race-free.
 */

import * as tenantRepo from '../repositories/tenant.js';
import * as usageRepo from '../repositories/usage.js';
import * as idempotencyRepo from '../repositories/idempotency.js';
import { calculateApiCallCost, calculateTokenCost } from '../domain/pricing.js';

/**
 * Record usage for a tenant
 * Idempotent: same key = same result, no duplicate charge
 *
 * @param {Object} db - DB connection (or transaction handle)
 * @param {number} tenantId - Tenant ID
 * @param {string} usageType - 'api_call' or 'ai_tokens'
 * @param {number} quantity - For api_call: count. For ai_tokens: total tokens (metadata separate)
 * @param {Object} tokens - Token breakdown (for ai_tokens type)
 * @param {string} idempotencyKey - Unique key for this request
 * @returns {Object} { event, cost, isDuplicate }
 */
export async function recordUsage(db, {
  tenantId,
  usageType,
  quantity,
  tokens = {},
  idempotencyKey,
}) {
  // 1. Lock the tenant row to serialize all operations for this tenant
  // This makes quota checks + metering race-free
  const tenant = await db.query(
    'SELECT * FROM tenants WHERE id = $1 FOR UPDATE',
    [tenantId]
  );

  if (tenant.rows.length === 0) {
    throw new Error('TENANT_NOT_FOUND');
  }

  const tenantRow = tenant.rows[0];

  // 2. Check if this idempotency key was already processed
  const requestHash = idempotencyRepo.hashRequest({
    tenantId,
    usageType,
    quantity,
    tokens,
  });

  const existing = await idempotencyRepo.validateIdempotencyKey(
    db,
    tenantId,
    idempotencyKey,
    requestHash
  );

  if (existing) {
    // Already processed: return the original response
    return {
      event: existing.body.event,
      cost: existing.body.cost,
      isDuplicate: true,
    };
  }

  // 3. Calculate cost
  let cost;
  if (usageType === 'api_call') {
    cost = calculateApiCallCost(quantity);
  } else if (usageType === 'ai_tokens') {
    cost = calculateTokenCost(tokens);
  } else {
    throw new Error('INVALID_USAGE_TYPE');
  }

  // 4. Record the usage event
  const event = await usageRepo.recordUsageEvent(db, {
    tenantId,
    usageType,
    quantity,
    inputTokens: tokens.input_tokens || 0,
    cachedInputTokens: tokens.cached_input_tokens || 0,
    outputTokens: tokens.output_tokens || 0,
    reasoningTokens: tokens.reasoning_tokens || 0,
    costNanoUsd: cost,
    idempotencyKey,
  });

  // 5. Store the idempotency key for future retries
  const response = { event, cost };
  await idempotencyRepo.store(
    db,
    tenantId,
    idempotencyKey,
    requestHash,
    200,
    response
  );

  return {
    event,
    cost,
    isDuplicate: false,
  };
}

/**
 * Calculate current usage for a tenant in the given month
 */
export async function getCurrentMonthUsage(db, tenantId, year, month) {
  const usage = await usageRepo.getMonthlyUsage(db, tenantId, year, month);

  // Rollup: current usage by type
  const byType = {};
  for (const row of usage) {
    byType[row.usage_type] = {
      quantity: Number(row.total_quantity || 0),
      cost: row.total_cost || 0n,
      events: row.event_count || 0,
    };
  }

  return {
    api_calls: byType.api_call?.quantity || 0,
    api_calls_cost: byType.api_call?.cost || 0n,
    ai_tokens: byType.ai_tokens?.quantity || 0,
    ai_tokens_cost: byType.ai_tokens?.cost || 0n,
    total_cost: (byType.api_call?.cost || 0n) + (byType.ai_tokens?.cost || 0n),
    by_type: byType,
  };
}

/**
 * Check if usage would exceed quota
 */
export function wouldExceedQuota(currentUsage, requestedUsage, limit, usageType) {
  const current = usageType === 'api_call'
    ? currentUsage.api_calls
    : currentUsage.ai_tokens;

  return (current + requestedUsage) > limit;
}
