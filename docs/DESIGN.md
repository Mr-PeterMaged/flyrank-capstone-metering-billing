# Design doc — Usage Metering & Billing Engine

## Problem
A SaaS needs to answer three questions per customer (tenant): **how much did they use, what does it cost, have they hit their plan limit?** — and keep the plan in sync with Stripe. The dangerous bugs are money bugs: a retry that double-counts, a webhook processed twice, an off-by-one at the quota boundary.

## Scope (intentionally small)
2 plans (Free / Pro) · 2 usage types (`api_call`, `ai_tokens`) · 1 dummy billable endpoint (`POST /generate`, tokens are simulated) · Stripe Checkout + 3 webhooks, test mode only.

**Explicit non-goal:** no invoicing, proration or overage billing. Usage past the limit is *rejected*, never billed.

## Plans
| Plan | API calls / month | AI tokens / month |
|------|------------------:|------------------:|
| Free | 1,000 | 100,000 |
| Pro  | 50,000 | 5,000,000 |

"Month" = calendar month in UTC. Limits live in the `plans` table.

## Data model
```
plans(id PK, name, api_calls_limit, ai_tokens_limit)
tenants(id PK, name, api_key_hash UNIQUE, plan_id FK, billing_status, stripe_customer_id UNIQUE)
subscriptions(id PK, tenant_id FK, stripe_subscription_id UNIQUE, plan_id, status, last_event_created, ...)
usage_events(id PK, tenant_id FK, usage_type, quantity, input/cached_input/output/reasoning_tokens,
             idempotency_key, occurred_at,  UNIQUE(tenant_id, idempotency_key, usage_type))
idempotency_keys(PK(tenant_id, key), request_hash, response_status, response_body)
webhook_events(stripe_event_id PK, type, outcome)
jobs / alerts   -- background worker + usage alerts
```
Every tenant-owned row carries `tenant_id`; the tenant is derived **only** from the API key, never from a request parameter, so one tenant can't address another's data.

## API surface
| Endpoint | Purpose |
|---|---|
| `POST /generate` (`Idempotency-Key` header required) | the billable action: 1 `api_call` + N `ai_tokens` |
| `GET /usage[?period=YYYY-MM]` | rollup: `{ used, limit, remaining, cost }` per type |
| `GET /pricing` | the pinned pricing constants |
| `POST /billing/checkout` | creates a Stripe Checkout Session for Pro |
| `POST /webhooks/stripe` | signature-verified, deduplicated event sink |
| `GET /health` | liveness |

## Layers
```
http/   (routes, validation, auth, error mapping)   -- no SQL, no business rules
services/ (meter, generate, usage, billing, webhook) -- rules; own the transactions
repositories/ (SQL only)                             -- take a db handle so they join a tx
domain/ (pure: period math, pricing)                 -- no I/O, unit-tested
jobs/ (Postgres-backed queue + worker)               -- off the request path
```

## Idempotency strategy (the heart)
1. Client sends `Idempotency-Key`. Scope = (tenant, key).
2. `MeterService.record` runs in **one DB transaction** that first takes `SELECT … FOR UPDATE` on the tenant row. All metering for a tenant is therefore serialized, which makes *both* dedupe and quota check race-free.
3. Inside the lock: key already stored? → same request hash: **replay the stored response** (status + body, header `Idempotent-Replayed: true`), no new event. Different payload: `422 idempotency_key_reused`.
4. Otherwise check billing status → quota → write idempotency row + usage events atomically.
5. Backstops: PK on `idempotency_keys`, UNIQUE on `usage_events`.
6. **Rejections are not stored.** A 402/429 creates no event and no charge, so re-evaluating on retry is safe (and lets a client retry after upgrading).

## Quota rule (boundary honesty)
`allowed  ⇔  used + requested ≤ limit`, all-or-nothing (no partial fulfilment).
At 999/1000 a 1-call request is allowed (→1000/1000); the next one is rejected.
- **429 `quota_exceeded`** — allowance used up. Has `Retry-After` (seconds to next period) + used/limit/requested/resets_at + upgrade hint.
- **402 `payment_required`** — subscription not in good standing (`past_due`/`unpaid`).

## Money
Integers only. Unit = **nano-USD** (1 USD = 10⁹). Token prices are pinned as integer nano-USD *per token* so every cost is an exact integer product — no rounding anywhere, and per-request costs sum exactly to the monthly rollup. Categories are **disjoint** and priced separately: fresh input, cached input (cheaper), output, reasoning (billed at the output rate).

## Stripe sync
Payment truth lives at Stripe. The DB changes plan/status **only** from verified events: verify signature on the raw body → claim `event.id` in `webhook_events` inside the same transaction as the state change (replay ⇒ no-op; failure ⇒ rollback ⇒ Stripe retries) → recompute the tenant's plan from its subscription rows (robust to out-of-order delivery).

## Risks I'm designing against
retry double-count · concurrent requests overshooting quota · same key with a different body · forged / replayed / reordered webhooks · float money · leaked secrets.
