import { existsSync } from "node:fs";

/** Loads .env.local / .env for CLI scripts (Node >= 20.12). Real environment variables win. */
export function loadLocalEnv() {
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) process.loadEnvFile(f);
  }
}
