import express from 'express';
import { fileURLToPath } from 'node:url';
import { setupRoutes } from './http/routes.js';
import { setupBillingRoutes } from './http/billing.js';
import { errorHandler } from './http/middleware.js';

export function createApp() {
  const app = express();
  // Stripe signs the exact bytes. Consume them before the general JSON parser.
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
    next();
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  // Signature authentication must run before the metering routes' tenant guard.
  setupBillingRoutes(app);
  setupRoutes(app);
  app.use((req, res) => res.status(404).json({ error: 'not_found', message: `${req.method} ${req.path} not found` }));
  app.use(errorHandler);
  return app;
}
