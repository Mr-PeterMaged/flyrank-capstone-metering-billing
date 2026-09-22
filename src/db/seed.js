import crypto from 'crypto';
import { getPool, closePool } from './pool.js';

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function seed() {
  const pool = getPool();

  try {
    console.log('🌱 Seeding demo data...');

    // Create demo tenant (Free plan)
    const tenantKey = 'sk_test_demo_free_' + crypto.randomBytes(16).toString('hex');
    const tenantKeyHash = hashApiKey(tenantKey);

    const tenantResult = await pool.query(
      `INSERT INTO tenants (name, api_key_hash, plan_id, billing_status)
       SELECT $1, $2, id, 'active'
       FROM plans WHERE name = 'Free'
       RETURNING id, name, plan_id`,
      ['Demo Tenant (Free)', tenantKeyHash]
    );

    const tenant = tenantResult.rows[0];
    console.log(`✅ Created demo tenant: ${tenant.name} (ID: ${tenant.id})`);
    console.log(`   API Key: ${tenantKey}`);

    // Create demo Pro tenant
    const proKey = 'sk_test_demo_pro_' + crypto.randomBytes(16).toString('hex');
    const proKeyHash = hashApiKey(proKey);

    const proTenantResult = await pool.query(
      `INSERT INTO tenants (name, api_key_hash, plan_id, billing_status, stripe_customer_id)
       SELECT $1, $2, id, 'active', $3
       FROM plans WHERE name = 'Pro'
       RETURNING id, name, plan_id`,
      ['Demo Tenant (Pro)', proKeyHash, 'cus_test_demo_pro']
    );

    const proTenant = proTenantResult.rows[0];
    console.log(`✅ Created demo Pro tenant: ${proTenant.name} (ID: ${proTenant.id})`);
    console.log(`   API Key: ${proKey}`);

    // Create a subscription for Pro tenant
    const currentDate = new Date();
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    await pool.query(
      `INSERT INTO subscriptions (tenant_id, stripe_subscription_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        proTenant.id,
        'sub_test_demo',
        proTenant.plan_id,
        'active',
        startOfMonth.toISOString().split('T')[0],
        endOfMonth.toISOString().split('T')[0]
      ]
    );
    console.log(`✅ Created demo subscription for Pro tenant`);

    // Add some demo usage
    const demoKey = crypto.randomUUID();
    await pool.query(
      `INSERT INTO usage_events (tenant_id, usage_type, quantity, cost_nano_usd, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant.id, 'api_call', 100, 100000n * 100n, demoKey]
    );
    console.log(`✅ Added demo usage event`);

    console.log('\n📝 Save these credentials for testing:');
    console.log(`   FREE_TENANT_ID=${tenant.id}`);
    console.log(`   FREE_API_KEY=${tenantKey}`);
    console.log(`   PRO_TENANT_ID=${proTenant.id}`);
    console.log(`   PRO_API_KEY=${proKey}`);

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

seed();
