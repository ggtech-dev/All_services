import pg from 'pg';
import 'dotenv/config';

export const SCHEMA = process.env.DB_SCHEMA || 'all_services';

// Every connection uses the app schema first, so queries can use bare table names.
export const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  options: `-c search_path=${SCHEMA},public`,
});

export const query = (text, params) => pool.query(text, params);

// Runs fn(client) in a transaction tagged with the acting user, so DB triggers can
// record who made each change (see fn_current_actor in db/functions.sql).
export async function asActor(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId == null ? '' : String(userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
