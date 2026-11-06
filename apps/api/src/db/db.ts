import pg from "pg";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** The only thing the app knows about the database. Production uses pg; tests use PGlite. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Runs fn inside one transaction. Rolls back if fn throws. */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

// timestamptz and date stay as JS Date / string; bigint and numeric come back as strings by default.
export function pgDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const wrap = (q: Pick<pg.Pool, "query">, inTx: boolean): Db => ({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const r = await q.query(sql, params as unknown[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await q.query(sql);
    },
    async tx(fn) {
      if (inTx) return fn(this); // already inside a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client, true));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  });
  return wrap(pool, false);
}
