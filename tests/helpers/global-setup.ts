import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Test database: uses TEST_DATABASE_URL if provided (must be a disposable DB!),
 * otherwise starts a throwaway embedded PostgreSQL (needs a non-root OS user).
 */
export default async function setup() {
  let stop: (() => Promise<void>) | undefined;
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = mkdtempSync(path.join(tmpdir(), "pnpay-pg-"));
    const port = 54000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("pnpay_test");
    url = `postgresql://postgres:postgres@localhost:${port}/pnpay_test`;
    stop = async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();

  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_PROVIDER = "memory";
  process.env.RECEIPT_STORAGE = "memory";

  return async () => {
    await stop?.();
  };
}
