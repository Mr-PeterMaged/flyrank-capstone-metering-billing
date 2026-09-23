#!/usr/bin/env node

import { createApp } from './app.js';
import { config, validateConfig } from './config/index.js';
import { getPool, closePool } from './db/pool.js';

async function startServer() {
  try {
    // Validate configuration
    validateConfig();
    console.log('✅ Configuration valid');

    // Initialize database connection
    const pool = getPool();
    const dbCheck = await pool.query('SELECT 1');
    console.log('✅ Database connection OK');

    const app = createApp();

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
