# LLM Usage Metering & Billing: deployment

## Vercel settings

| Setting | Value |
|---|---|
| Root Directory | `.` |
| Framework Preset | Other |
| Node.js | 24.x |
| Install Command | `node --version` (backend dependencies are not needed for static assets) |
| Build Command | `node scripts/build-vercel.mjs` |
| Output Directory | Leave unset; the build emits Build Output API v3 |
| Entry page | `/` |

Set `BACKEND_ORIGIN=https://your-backend-host.example` in Vercel for each environment. Replace this example with a real reachable backend. Use an HTTPS origin without a trailing slash or path. Never point it at this Vercel frontend. Redeploy after changes.

The build publishes only web assets selected in `deployment.json`. Source code, environment files, databases and notebooks are excluded. Files are served first; remaining paths are forwarded to the backend when configured. API requests stay on the frontend origin. Keep private responses uncacheable and session cookies host-only (no backend-domain cookie attribute).

## Backend setup

Deploy the Node.js service with PostgreSQL. Run npm ci, npm run migrate, npm run seed and npm start. Set DATABASE_URL and Stripe test-mode variables from .env.example. Configure checkout return URLs and the Stripe webhook endpoint on the public domain. Live-mode billing is outside the verified scope.

## Build and verification

Run `node scripts/build-vercel.mjs` with the environment above. Each build validates and replaces only generated `.vercel/output`, so committed build snapshots do not block deployment. Missing or malformed backend configuration fails the build. A successful build verifies packaging, not remote backend availability.

Existing checks: `npm test`. After deployment, check desktop/mobile layout and the developer link, then exercise the real application workflow. Verify health, authentication, writes and logout where applicable. Configure the backend before expecting application data or jobs to work.

## Ownership

Designed and developed by [Peter Maged](https://petermaged.com/). See [LICENSE](LICENSE) for source terms. Third-party libraries, datasets and upstream materials keep their own terms. Website credits do not replace the source license.

Reference: [Vercel Build Output API](https://vercel.com/docs/build-output-api).
