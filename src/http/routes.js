import express from 'express';
import { getPool, withTransaction, closePool } from '../db/pool.js';
import * as meterService from '../services/meter.js';
import { pricing, formatCost } from '../config/index.js';
import { getCurrentPeriod, secondsUntilNextPeriod } from '../domain/period.js';
import { nanoUsdToUsd } from '../domain/pricing.js';
import {
  extractApiKey,
  authenticateTenant,
  validateIdempotencyKey,
  healthCheck
} from './middleware.js';

export function setupRoutes(app) {
  const pool = getPool();

  // ===== PUBLIC ROUTES =====

  app.get('/health', healthCheck);

  // Show pricing constants
  app.get('/pricing', (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      constants: {
        api_call: nanoUsdToUsd(pricing.api_call),
        input_token: nanoUsdToUsd(pricing.input_token),
        cached_input_token: nanoUsdToUsd(pricing.cached_input_token),
        output_token: nanoUsdToUsd(pricing.output_token),
        reasoning_token: nanoUsdToUsd(pricing.reasoning_token),
      },
      unit: 'USD',
    });
  });

  // ===== AUTHENTICATED ROUTES (require Bearer token) =====

  app.use(extractApiKey);
  app.use(authenticateTenant);

  /**
   * POST /generate
   * Record usage for an API call
   *
   * Required header: Idempotency-Key
   *
   * Body:
   * {
   *   "tokens": {
   *     "input_tokens": 100,
   *     "cached_input_tokens": 0,
   *     "output_tokens": 500,
   *     "reasoning_tokens": 0
   *   }
   * }
   */
  app.post('/generate', validateIdempotencyKey, async (req, res, next) => {
    try {
      const { tokens = {} } = req.body || {};
      const tenant = req.tenant;
      const now = new Date();
      const period = getCurrentPeriod(now);

      // Use transaction to ensure atomicity
      const result = await withTransaction(async (db) => {
        // Get current usage
        const currentUsage = await meterService.getCurrentMonthUsage(
          db,
          tenant.id,
          period.year,
          period.month
        );

        // Check quota for API call (1 call)
        if (meterService.wouldExceedQuota(
          currentUsage, 1, tenant.api_calls_limit, 'api_call'
        )) {
          const err = new Error('QUOTA_EXCEEDED');
          await db.query(
            `INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              tenant.id,
              req.idempotencyKey,
              require('crypto').createHash('sha256').update(JSON.stringify(req.body)).digest('hex'),
              429,
              JSON.stringify({
                error: 'quota_exceeded',
                used: currentUsage.api_calls,
                limit: tenant.api_calls_limit,
                requested: 1,
              })
            ]
          );
          throw err;
        }

        // Check quota for AI tokens
        const totalTokens = (tokens.input_tokens || 0) +
                          (tokens.cached_input_tokens || 0) +
                          (tokens.output_tokens || 0) +
                          (tokens.reasoning_tokens || 0);

        if (meterService.wouldExceedQuota(
          currentUsage, totalTokens, tenant.ai_tokens_limit, 'ai_tokens'
        )) {
          const err = new Error('QUOTA_EXCEEDED');
          await db.query(
            `INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              tenant.id,
              req.idempotencyKey,
              require('crypto').createHash('sha256').update(JSON.stringify(req.body)).digest('hex'),
              429,
              JSON.stringify({
                error: 'quota_exceeded',
                type: 'ai_tokens',
                used: currentUsage.ai_tokens,
                limit: tenant.ai_tokens_limit,
                requested: totalTokens,
              })
            ]
          );
          throw err;
        }

        // Record API call
        const apiCallResult = await meterService.recordUsage(db, {
          tenantId: tenant.id,
          usageType: 'api_call',
          quantity: 1,
          idempotencyKey: req.idempotencyKey,
        });

        // Record AI tokens if provided
        let tokensResult = null;
        if (totalTokens > 0) {
          const tokenKey = req.idempotencyKey + ':tokens';
          tokensResult = await meterService.recordUsage(db, {
            tenantId: tenant.id,
            usageType: 'ai_tokens',
            quantity: totalTokens,
            tokens,
            idempotencyKey: tokenKey,
          });
        }

        return { apiCallResult, tokensResult };
      });

      const isDuplicate = result.apiCallResult.isDuplicate;
      const totalCost = result.apiCallResult.cost + (result.tokensResult?.cost || 0n);

      res.status(isDuplicate ? 200 : 201).set('Idempotent-Replayed', isDuplicate ? 'true' : 'false').json({
        success: true,
        request_id: req.idempotencyKey,
        cost: {
          nano_usd: totalCost.toString(),
          usd: nanoUsdToUsd(totalCost),
        },
        usage: {
          api_calls: 1,
          ai_tokens: result.tokensResult ? tokens : {},
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /usage
   * Get current month's usage for the tenant
   */
  app.get('/usage', async (req, res, next) => {
    try {
      const tenant = req.tenant;
      const now = new Date();
      const period = getCurrentPeriod(now);

      const usage = await meterService.getCurrentMonthUsage(
        pool,
        tenant.id,
        period.year,
        period.month
      );

      res.json({
        timestamp: new Date().toISOString(),
        period: {
          year: period.year,
          month: period.month,
          start: period.start,
          end: period.end,
          resets_in_seconds: secondsUntilNextPeriod(now),
        },
        usage: {
          api_calls: {
            used: usage.api_calls,
            limit: tenant.api_calls_limit,
            remaining: Math.max(0, tenant.api_calls_limit - usage.api_calls),
          },
          ai_tokens: {
            used: usage.ai_tokens,
            limit: tenant.ai_tokens_limit,
            remaining: Math.max(0, tenant.ai_tokens_limit - usage.ai_tokens),
          },
        },
        cost: {
          api_calls: nanoUsdToUsd(usage.api_calls_cost),
          ai_tokens: nanoUsdToUsd(usage.ai_tokens_cost),
          total: nanoUsdToUsd(usage.total_cost),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return app;
}
