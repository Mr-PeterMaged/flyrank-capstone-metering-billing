#!/usr/bin/env node

import express from 'express';
import { config, validateConfig } from './config/index.js';
import { getPool, closePool } from './db/pool.js';
import { setupRoutes } from './http/routes.js';
import { setupBillingRoutes } from './http/billing.js';
import { errorHandler } from './http/middleware.js';

async function startServer() {
  try {
    // Validate configuration
    validateConfig();
    console.log('✅ Configuration valid');

    // Initialize database connection
    const pool = getPool();
    const dbCheck = await pool.query('SELECT 1');
    console.log('✅ Database connection OK');

    // Create Express app
    const app = express();

    // Middleware
    app.use(express.json());

    // Logging middleware
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      });
      next();
    });

    // Routes
    setupRoutes(app);
    setupBillingRoutes(app);

    // 404
    app.use((req, res) => {
      res.status(404).json({
        error: 'not_found',
        message: `${req.method} ${req.path} not found`,
      });
    });

    // Error handler
    app.use(errorHandler);

    // Start listening
    const port = config.port;
    app.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
      console.log(`📖 API docs at http://localhost:${port}/pricing`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      await closePool();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully...');
      await closePool();
      process.exit(0);
    });

  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

startServer();
