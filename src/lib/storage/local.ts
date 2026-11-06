import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReceiptStorage } from "./types";

/**
 * Development-only provider: files under .dev-receipts/ (git-ignored). Refused in production by env
 * validation, because the Vercel filesystem is ephemeral and must never hold receipts.
 */
export class LocalStorage implements ReceiptStorage {
  readonly name = "local";
  constructor(private readonly root = path.resolve(process.cwd(), ".dev-receipts")) {}

  private file(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return full;
  }
  async put(key: string, bytes: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes);
  }
  async size(key: string) {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }
  async read(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
