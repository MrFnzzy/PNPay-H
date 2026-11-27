/**
 * Controlled admin setup (LLD 4.3). Run by the system owner, never exposed over HTTP.
 *   ADMIN_FULL_NAME, ADMIN_EMAIL, ADMIN_PASSWORD come from the environment / .env.local.
 *   npm run admin:create                    -> creates the single admin
 *   npm run admin:create -- --reset-password -> resets that admin's password
 * The password is never printed.
 */
import { closeDb } from "../src/db";
import { createAdmin } from "../src/lib/auth/admin-setup";
import { loadLocalEnv } from "./_env";

loadLocalEnv();

async function main() {
  const reset = process.argv.includes("--reset-password");
  const res = await createAdmin(
    { fullName: process.env.ADMIN_FULL_NAME ?? "", email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" },
    { resetPassword: reset },
  );
  console.log(res.action === "created" ? "Admin account created." : "Admin password reset.");
  await closeDb();
}
main().catch(async (e) => {
  console.error("Admin setup failed:", e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
