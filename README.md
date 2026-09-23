# LLM Usage Metering & Billing

**Designed and developed by [Peter Maged](https://petermaged.com/).**

Measure AI usage, enforce quotas and reconcile subscription events through an auditable service foundation.

## Product and technical overview

- **Implementation:** Node.js, Express 5, PostgreSQL, exact integer pricing, Stripe test mode.
- **Deployment:** Vercel frontend with an external backend; [DEPLOYMENT.md](DEPLOYMENT.md) contains exact settings and operational requirements.
- **Ownership:** Peter Maged's project implementation; third-party libraries and upstream materials retain their attribution.
- **License:** [LICENSE](LICENSE). Available for portfolio review, evaluation and further development under these terms.

For project enquiries and implementation work: [petermaged.com](https://petermaged.com/).

## Webhook verification

`npm test` runs isolated checks. For the PostgreSQL integration test, migrate a dedicated test database and set `WEBHOOK_TEST_DATABASE_URL` before `npm test`. Never use a production database for tests. Stripe payloads are verified as raw bytes before tenant middleware, and database errors return retryable responses.

## Engineering guide and existing evidence

# 💰 Usage Metering & Billing Engine

A production-grade backend service for SaaS billing: exactly-once metering, quota enforcement, cost calculation, and Stripe subscription sync in test mode. **Money-safe** by design.

## What it does

Three critical questions every SaaS must answer:
1. **How much did this customer use?** → Metering with idempotent deduplication
2. **How much should they pay?** → AI-token pricing rules (cached input, reasoning tokens) + integer money math
3. **Have they hit their limit?** → Quota enforcement with 429/402 status codes

## Features

✅ **Exactly-once metering** — retries never create duplicate charges (idempotency-key + DB lock)  
✅ **Quota enforcement** — 429 (quota exceeded) vs 402 (payment required), with clear messages  
✅ **Correct money math** — integers (nano-USD), no floats, token categories separate  
✅ **Stripe Checkout** — test mode only, free, no credit card ever  
✅ **Verified webhooks** — signature validation, deduplication, idempotent processing  
✅ **Subscription sync** — payment truth lives at Stripe, DB mirrors via verified events  

## Stack

- **Runtime:** Node.js 22+ (ES modules)
- **Framework:** Express.js 5
- **Database:** PostgreSQL 16 (or SQLite for dev)
- **Payments:** Stripe (test mode)
- **Validation:** Zod

## Getting started

### 1. Prerequisites

```bash
# Check Node.js version
node -v  # ≥22.0.0

# Docker Compose (for PostgreSQL)
docker --version
docker compose --version
```

### 2. Clone & install

```bash
git clone <your-repo>
cd <your-repo>
npm install
```

### 3. Environment setup

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Database (uncomment one)
DATABASE_URL=postgres://metering:metering@localhost:5442/metering

# Stripe test mode (get from https://dashboard.stripe.com/test/apikeys)
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE
STRIPE_PRICE_PRO=price_YOUR_PRICE_ID
```

### 4. Start PostgreSQL

```bash
docker compose up -d db
```

Wait for health check:

```bash
docker compose ps  # should show "healthy"
```

### 5. Run migrations

```bash
npm run migrate
```

Expected output:

```
✅ Running migration: 001_create_plans
✅ Running migration: 002_create_tenants
...
✅ All migrations completed
```

### 6. Seed demo data

```bash
npm run seed
```

Save these credentials from the output:

```
FREE_TENANT_ID=1
FREE_API_KEY=sk_test_demo_free_...
PRO_TENANT_ID=2
PRO_API_KEY=sk_test_demo_pro_...
```

### 7. Start the server

```bash
npm start
```

Expected output:

```
✅ Configuration valid
✅ Database connection OK
🚀 Server running on http://localhost:3000
```

## Usage

### Health check

```bash
curl http://localhost:3000/health
# { "status": "ok", "timestamp": "2024-09-22T..." }
```

### View pricing

```bash
curl http://localhost:3000/pricing
# { "constants": { "api_call": "0.0001", "input_token": "0.00000015", ... } }
```

### Record usage (authenticated, requires idempotency key)

```bash
API_KEY="sk_test_demo_free_..."
curl -X POST http://localhost:3000/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": {
      "input_tokens": 100,
      "cached_input_tokens": 0,
      "output_tokens": 500,
      "reasoning_tokens": 0
    }
  }'
```

Response:

```json
{
  "success": true,
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "cost": {
    "nano_usd": "350000",
    "usd": "00000035"
  }
}
```

### Check usage & quotas

```bash
curl http://localhost:3000/usage \
  -H "Authorization: Bearer $API_KEY"
```

Response:

```json
{
  "period": {
    "start": "2024-09-01",
    "end": "2024-09-30",
    "resets_in_seconds": 345600
  },
  "usage": {
    "api_calls": { "used": 100, "limit": 1000, "remaining": 900 },
    "ai_tokens": { "used": 600, "limit": 100000, "remaining": 99400 }
  },
  "cost": {
    "api_calls": "0.00001",
    "ai_tokens": "00000036",
    "total": "00000037"
  }
}
```

## Plans

| Plan | API calls / month | AI tokens / month |
|------|------------------:|------------------:|
| Free | 1,000 | 100,000 |
| Pro | 50,000 | 5,000,000 |

## API Reference

### Authentication

All endpoints except `/health` and `/pricing` require:

```
Authorization: Bearer sk_test_...
```

### Metering

**POST /generate** — Record 1 API call + N AI tokens (billable action)

Headers:
- `Authorization: Bearer sk_test_...` ✅ required
- `Idempotency-Key: <uuid>` ✅ required (prevents double-counting on retries)
- `Content-Type: application/json`

Body:

```json
{
  "tokens": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0
  }
}
```

Responses:
- `201 Created` — new usage recorded
- `200 OK` + `Idempotent-Replayed: true` — duplicate, original result returned
- `429 Too Many Requests` — quota exceeded (include `Retry-After` header)
- `402 Payment Required` — subscription not in good standing
- `422 Unprocessable Entity` — same key with different payload

**GET /usage** — Get current month usage & cost

Query params:
- `period=YYYY-MM` (optional) — defaults to current month

Response: monthly usage, remaining quota, total cost

### Billing

**POST /billing/checkout** — Create Stripe Checkout session to upgrade to Pro

Response:

```json
{
  "checkout": {
    "session_id": "cs_test_...",
    "url": "https://checkout.stripe.com/pay/cs_test_..."
  }
}
```

**POST /webhooks/stripe** — Stripe webhook sink (signature-verified, idempotent)

Events handled:
- `checkout.session.completed` — subscription created
- `customer.subscription.updated` — plan/status changed
- `customer.subscription.deleted` — downgrade to Free

## Testing

### Run the test suite

```bash
npm test
```

Expected: all tests pass

### Manual testing (idempotency)

Send the same request twice with the same idempotency key:

```bash
KEY="test-key-123"
API_KEY="sk_test_demo_free_..."

# First request
curl -X POST http://localhost:3000/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"tokens":{"input_tokens":100,"output_tokens":500}}'

# Second request (same key, same payload)
# Should return identical response with Idempotent-Replayed: true
curl -X POST http://localhost:3000/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"tokens":{"input_tokens":100,"output_tokens":500}}'
```

Verify:
- Both responses are identical
- Second response includes `Idempotent-Replayed: true` header
- Usage events table has exactly 1 entry (not 2)

### Manual testing (quota boundary)

```bash
API_KEY="sk_test_demo_free_..."

# Check usage (expect 0)
curl http://localhost:3000/usage -H "Authorization: Bearer $API_KEY" | jq .usage.api_calls

# Send 999 calls (allowed)
for i in {1..999}; do
  curl -X POST http://localhost:3000/generate \
    -H "Authorization: Bearer $API_KEY" \
    -H "Idempotency-Key: call-$i" \
    -H "Content-Type: application/json" \
    -d '{}' >/dev/null
done

# Send 1000th call (allowed, reaches limit)
curl -X POST http://localhost:3000/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: call-1000" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .success

# Send 1001st call (rejected, 429)
curl -X POST http://localhost:3000/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: call-1001" \
  -H "Content-Type: application/json" \
  -d '{}'
# Should return 429 with error: quota_exceeded
```

## Architecture

```
http/
  ├─ routes.js          # Metering endpoints (/generate, /usage)
  ├─ billing.js         # Billing endpoints (/checkout, /webhooks/stripe)
  └─ middleware.js      # Auth, validation, error handling

services/
  ├─ meter.js           # Usage recording (idempotent, quota-aware)
  └─ stripe.js          # Stripe integration (checkout, webhooks)

repositories/
  ├─ tenant.js          # Tenant queries
  ├─ usage.js           # Usage event queries
  ├─ idempotency.js     # Idempotency key validation
  └─ webhook.js         # Subscription queries

domain/
  ├─ period.js          # Month math (no I/O)
  ├─ pricing.js         # Cost calculation (no I/O)

db/
  ├─ pool.js            # Connection pooling & transactions
  ├─ migrate.js         # Schema migrations
  └─ seed.js            # Demo data
```

**Layered design:**
- `http/` — HTTP only (routes, validation, auth)
- `services/` — Business rules (meter, quotas, billing)
- `repositories/` — SQL queries (take db handle for transaction join)
- `domain/` — Pure logic (no I/O, unit-tested)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Retry double-count** | Idempotency key + DB UNIQUE constraint + FOR UPDATE lock |
| **Concurrent quota overshoot** | All tenant operations serialized via SELECT…FOR UPDATE |
| **Float money errors** | Integers only (nano-USD), no floats anywhere |
| **Webhook replays** | Stripe event ID deduplication + transaction atomicity |
| **Out-of-order webhooks** | Recompute plan from subscription rows (idempotent) |
| **Leaked secrets** | .env git-ignored, .env.example has placeholders only |

## Limitations

❌ No invoicing (generate static PDF invoices separately)  
❌ No proration (charge full pro-rata outside this system)  
❌ No overage billing (usage past limit is rejected, never billed)  
❌ No alerts (email/SMS at 80% quota is a job for a separate service)  
❌ No Stripe live mode (test mode only, by design)

## Deployment

### Production checklist

- [ ] DATABASE_URL points to production database
- [ ] STRIPE_SECRET_KEY is `sk_live_...` (NOT `sk_test_`)
- [ ] STRIPE_WEBHOOK_SECRET matches live mode webhook
- [ ] All migrations have run
- [ ] Error logs are monitored
- [ ] webhook_events table is monitored for failures
- [ ] Database backups are enabled

### Environment

```bash
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
STRIPE_SECRET_KEY=sk_live_...  # NOT sk_test_
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Costs

$0 to run (literally):
- Node.js: free
- PostgreSQL: free (Docker)
- Stripe test mode: free, no credit card
- This code: MIT license, go build on it

## License

MIT
