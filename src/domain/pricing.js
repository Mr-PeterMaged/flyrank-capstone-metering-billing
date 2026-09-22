// Pure domain logic for pricing (no I/O)

import { pricing } from '../config/index.js';

/**
 * Calculate cost for an API call
 * @param {number} quantity - Number of API calls
 * @returns {bigint} Cost in nano-USD
 */
export function calculateApiCallCost(quantity) {
  if (quantity < 0) throw new Error('Quantity must be non-negative');
  return BigInt(quantity) * pricing.api_call;
}

/**
 * Calculate cost for AI tokens with separate pricing for each category
 * Must match real pricing rules:
 * - input_tokens and cached_input_tokens are priced separately
 * - reasoning_tokens count as output_tokens (same rate)
 * - Categories cannot be simply added together
 *
 * @param {Object} tokens - Token breakdown
 * @param {number} tokens.input_tokens - Fresh input tokens
 * @param {number} tokens.cached_input_tokens - Cached input tokens
 * @param {number} tokens.output_tokens - Output tokens
 * @param {number} tokens.reasoning_tokens - Reasoning/thinking tokens
 * @returns {bigint} Cost in nano-USD
 */
export function calculateTokenCost(tokens) {
  const {
    input_tokens = 0,
    cached_input_tokens = 0,
    output_tokens = 0,
    reasoning_tokens = 0,
  } = tokens;

  // Validate
  if (input_tokens < 0 || cached_input_tokens < 0 || output_tokens < 0 || reasoning_tokens < 0) {
    throw new Error('Token counts must be non-negative');
  }

  // Calculate each category separately
  const inputCost = BigInt(input_tokens) * pricing.input_token;
  const cachedInputCost = BigInt(cached_input_tokens) * pricing.cached_input_token;

  // Reasoning tokens count as output tokens (same rate)
  const totalOutputTokens = output_tokens + reasoning_tokens;
  const outputCost = BigInt(totalOutputTokens) * pricing.output_token;

  // Total: each category is independent
  return inputCost + cachedInputCost + outputCost;
}

/**
 * Validate that pricing constants make sense
 */
export function validatePricing() {
  const errors = [];

  if (pricing.api_call <= 0n) errors.push('api_call price must be > 0');
  if (pricing.input_token <= 0n) errors.push('input_token price must be > 0');
  if (pricing.cached_input_token >= pricing.input_token) {
    errors.push('cached_input_token must be cheaper than input_token');
  }
  if (pricing.output_token <= 0n) errors.push('output_token price must be > 0');
  if (pricing.reasoning_token !== pricing.output_token) {
    errors.push('reasoning_token must equal output_token rate');
  }

  if (errors.length > 0) {
    throw new Error('Pricing validation failed: ' + errors.join('; '));
  }
}

/**
 * Convert nano-USD to USD string
 */
export function nanoUsdToUsd(nanoUsd) {
  const usd = Number(nanoUsd) / 1e9;
  return usd.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Convert USD to nano-USD (for display/testing)
 */
export function usdToNanoUsd(usd) {
  return Math.round(usd * 1e9);
}

// Validate on import
validatePricing();
