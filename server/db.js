import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Defensive: make sure the pgvector extension is present even if the
// post-merge bootstrap script was skipped (e.g. local dev). Idempotent.
pool.query("CREATE EXTENSION IF NOT EXISTS vector").catch((err) => {
  console.warn("[db] could not ensure pgvector extension:", err.message);
});
