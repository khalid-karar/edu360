import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "./db.js";

/** A real PostgreSQL (PGlite, in-process) behind the same Db interface the app uses in production. */
export function pgliteDb(pg: PGlite): Db {
  type Q = Pick<PGlite, "query" | "exec">;
  const wrap = (q: Q, inTx: boolean): Db => ({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const r = await q.query<T>(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
    },
    async exec(sql) {
      await q.exec(sql);
    },
    async tx(fn) {
      if (inTx) return fn(this);
      return pg.transaction((t) => fn(wrap(t, true)));
    },
    end: () => pg.close(),
  });
  return wrap(pg, false);
}

