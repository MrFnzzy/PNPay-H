import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __pnpayPool?: Pool; __pnpayDb?: Db };

export function getDb(): Db {
  if (g.__pnpayDb) return g.__pnpayDb;
  const pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 60_000,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", () => {
    /* idle client errors must not crash the process; they are not logged with details */
  });
  g.__pnpayPool = pool;
  g.__pnpayDb = drizzle(pool, { schema });
  return g.__pnpayDb;
}

export async function closeDb() {
  await g.__pnpayPool?.end();
  g.__pnpayPool = undefined;
  g.__pnpayDb = undefined;
}

export { schema };
