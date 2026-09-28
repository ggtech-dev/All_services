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
