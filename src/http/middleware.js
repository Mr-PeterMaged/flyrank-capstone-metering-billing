import { getPool, withTransaction } from '../db/pool.js';
import * as tenantRepo from '../repositories/tenant.js';

/**
 * Extract and validate API key from headers
 */
export function extractApiKey(req, res, next) {
  const auth = req.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/);

  if (!match) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header. Use: Bearer sk_test_...',
    });
  }

  req.apiKey = match[1];
  next();
}

/**
 * Authenticate tenant from API key
 */
export async function authenticateTenant(req, res, next) {
  try {
    const pool = getPool();
    const apiKeyHash = tenantRepo.hashApiKey(req.apiKey);
    const tenant = await tenantRepo.findByApiKey(pool, apiKeyHash);

    if (!tenant) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid API key',
      });
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    res.status(500).json({
      error: 'internal_error',
      message: err.message,
    });
  }
}

/**
 * Extract and validate Idempotency-Key header
 */
export function validateIdempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key');

  if (!key) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Idempotency-Key header is required',
    });
  }

  // UUID or similar format
  if (!/^[a-z0-9_-]{20,}$/i.test(key)) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Idempotency-Key must be a valid UUID or similar',
    });
  }

  req.idempotencyKey = key;
  next();
}

/**
 * Error handler middleware
 */
export function errorHandler(err, req, res, next) {
  const statusMap = {
    'TENANT_NOT_FOUND': 404,
    'IDEMPOTENCY_KEY_REUSED': 422,
    'INVALID_USAGE_TYPE': 400,
    'QUOTA_EXCEEDED': 429,
    'PAYMENT_REQUIRED': 402,
  };

  const status = statusMap[err.message] || 500;
  const isClientError = status < 500;

  if (!isClientError) {
    console.error('❌ Unhandled error:', err);
  }

  res.status(status).json({
    error: err.message,
    message: err.message,
  });
}

/**
 * Health check middleware
 */
export function healthCheck(req, res) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
