import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    const dbUrl = config.env === 'test' ? config.database.testUrl : config.database.url;
    pool = new Pool({
      connectionString: dbUrl,
      statement_timeout: 30000, // 30s max per statement
      query_timeout: 30000,
    });

    pool.on('error', (err) => {
      console.error('❌ Unexpected error on idle client', err);
      process.exit(-1);
    });
  }
  return pool;
}

export async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
