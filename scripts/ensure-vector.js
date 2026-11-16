import pg from "pg";

const stage = process.argv[2] || "pre";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; skipping vector setup");
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  if (stage === "pre") {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("[ensure-vector] pgvector extension ready");
  } else if (stage === "post") {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'muse_memories'`
    );
    if (rows.length === 0) {
      console.log("[ensure-vector] muse_memories table missing; skipping index");
    } else {
      await client.query(
        `CREATE INDEX IF NOT EXISTS muse_memories_embedding_idx
         ON muse_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
      );
      console.log("[ensure-vector] muse_memories ivfflat index ready");
    }
  } else {
    console.error(`Unknown stage: ${stage}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`[ensure-vector ${stage}] failed:`, err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
