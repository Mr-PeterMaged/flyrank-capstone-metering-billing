import 'dotenv/config.js';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  logLevel: process.env.LOG_LEVEL || 'info',
  database: {
    url: process.env.DATABASE_URL || 'postgres://metering:metering@localhost:5442/metering',
    testUrl: process.env.TEST_DATABASE_URL || 'postgres://metering:metering@localhost:5442/metering_test',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    pricePro: process.env.STRIPE_PRICE_PRO || '',
    checkoutSuccessUrl: process.env.CHECKOUT_SUCCESS_URL || 'http://localhost:3000/health?checkout=success',
    checkoutCancelUrl: process.env.CHECKOUT_CANCEL_URL || 'http://localhost:3000/health?checkout=cancelled',
  },
  worker: {
    enabled: process.env.WORKER_ENABLED === 'true',
    pollIntervalMs: parseInt(process.env.JOB_POLL_INTERVAL_MS || '1000'),
    maxAttempts: parseInt(process.env.JOB_MAX_ATTEMPTS || '5'),
    retryBaseMs: parseInt(process.env.JOB_RETRY_BASE_MS || '2000'),
  },
};

// Pricing constants (nano-USD: 1 USD = 10^9)
export const pricing = {
  api_call: 100000n, // $0.0001 per API call
  input_token: 150n, // $0.00000015 per input token (Claude 3.5 Haiku)
  cached_input_token: 75n, // $0.000000075 per cached input (50% discount)
  output_token: 600n, // $0.0000006 per output token
  reasoning_token: 600n, // reasoning counts as output
};

export function formatCost(nanoUsd) {
  const usd = Number(nanoUsd) / 1e9;
  return usd.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}

export function validateConfig() {
  const errors = [];

  if (!config.database.url) {
    errors.push('DATABASE_URL is required');
  }

  if (config.env !== 'test' && !config.stripe.secretKey) {
    errors.push('STRIPE_SECRET_KEY is required (Stripe test mode)');
  }

  if (config.env !== 'test' && !config.stripe.webhookSecret) {
    errors.push('STRIPE_WEBHOOK_SECRET is required');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:', errors);
    process.exit(1);
  }
}
