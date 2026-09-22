import { getPool, closePool } from './pool.js';
import { config } from '../config/index.js';

const migrations = [
  // 001: Create plans
  {
    name: '001_create_plans',
    up: `
      CREATE TABLE IF NOT EXISTS plans (
        id BIGSERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        api_calls_limit BIGINT NOT NULL,
        ai_tokens_limit BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO plans (name, api_calls_limit, ai_tokens_limit) VALUES
        ('Free', 1000, 100000),
        ('Pro', 50000, 5000000)
      ON CONFLICT (name) DO NOTHING;
    `,
  },

  // 002: Create tenants
  {
    name: '002_create_tenants',
    up: `
      CREATE TABLE IF NOT EXISTS tenants (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT UNIQUE NOT NULL,
        plan_id BIGINT NOT NULL REFERENCES plans(id),
        billing_status TEXT DEFAULT 'active' CHECK (billing_status IN ('active', 'past_due', 'unpaid', 'canceled')),
        stripe_customer_id TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_tenants_api_key_hash ON tenants(api_key_hash);
      CREATE INDEX idx_tenants_stripe_customer_id ON tenants(stripe_customer_id);
    `,
  },

  // 003: Create subscriptions
  {
    name: '003_create_subscriptions',
    up: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        stripe_subscription_id TEXT UNIQUE NOT NULL,
        plan_id BIGINT NOT NULL REFERENCES plans(id),
        status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid')),
        current_period_start DATE NOT NULL,
        current_period_end DATE NOT NULL,
        last_event_id TEXT,
        last_event_created TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
      CREATE INDEX idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
    `,
  },

  // 004: Create usage_events
  {
    name: '004_create_usage_events',
    up: `
      CREATE TABLE IF NOT EXISTS usage_events (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        usage_type TEXT NOT NULL CHECK (usage_type IN ('api_call', 'ai_tokens')),
        quantity BIGINT NOT NULL,

        -- Token breakdown (only for ai_tokens type)
        input_tokens BIGINT DEFAULT 0,
        cached_input_tokens BIGINT DEFAULT 0,
        output_tokens BIGINT DEFAULT 0,
        reasoning_tokens BIGINT DEFAULT 0,

        -- Cost in nano-USD
        cost_nano_usd BIGINT NOT NULL,

        -- Idempotency
        idempotency_key TEXT NOT NULL,

        occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE (tenant_id, idempotency_key)
      );

      CREATE INDEX idx_usage_events_tenant_id ON usage_events(tenant_id);
      CREATE INDEX idx_usage_events_occurred_at ON usage_events(occurred_at);
      CREATE INDEX idx_usage_events_idempotency ON usage_events(tenant_id, idempotency_key);
    `,
  },

  // 005: Create idempotency_keys
  {
    name: '005_create_idempotency_keys',
    up: `
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (tenant_id, key)
      );

      CREATE INDEX idx_idempotency_keys_created ON idempotency_keys(created_at);
    `,
  },

  // 006: Create webhook_events
  {
    name: '006_create_webhook_events',
    up: `
      CREATE TABLE IF NOT EXISTS webhook_events (
        stripe_event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('processed', 'ignored', 'failed')),
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_webhook_events_created ON webhook_events(created_at);
    `,
  },

  // 007: Create jobs (for background workers)
  {
    name: '007_create_jobs',
    up: `
      CREATE TABLE IF NOT EXISTS jobs (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        tenant_id BIGINT REFERENCES tenants(id),
        payload JSONB NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        attempts INTEGER DEFAULT 0,
        next_retry_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_jobs_status ON jobs(status);
      CREATE INDEX idx_jobs_next_retry ON jobs(next_retry_at) WHERE status = 'pending';
    `,
  },
];

async function migrate() {
  const pool = getPool();

  try {
    // Create migrations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Run migrations
    for (const migration of migrations) {
      const result = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [migration.name]
      );

      if (result.rows.length === 0) {
        console.log(`⏳ Running migration: ${migration.name}`);
        await pool.query(migration.up);
        await pool.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [migration.name]
        );
        console.log(`✅ Migration completed: ${migration.name}`);
      }
    }

    console.log('✅ All migrations completed');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();
