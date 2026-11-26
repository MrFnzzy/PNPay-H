import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/db";
import { loadLocalEnv } from "./_env";

loadLocalEnv();

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await closeDb();
}
main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
