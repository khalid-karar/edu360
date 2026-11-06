import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Db } from "./db.js";

// Works from both src/db and dist/db: the migrations folder sits two levels up.
const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "migrations");

/** Applies every migrations/NNNN_*.sql file not yet recorded, in order. Each runs in its own transaction. */
export async function migrate(db: Db, dir = DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), "utf8");
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
