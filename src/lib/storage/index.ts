import path from "node:path";
import { getEnv } from "@/lib/env";
import { LocalStorage } from "./local";
import { MemoryStorage } from "./memory";
import { PostgresStorage } from "./postgres";
import type { ReceiptStorage } from "./types";
import { VercelBlobStorage } from "./vercel-blob";

export type { ReceiptStorage } from "./types";
export { MemoryStorage } from "./memory";

let instance: ReceiptStorage | undefined;

export function getReceiptStorage(): ReceiptStorage {
  if (instance) return instance;
  const env = getEnv();
  if (env.RECEIPT_STORAGE === "vercel-blob") instance = new VercelBlobStorage(env.BLOB_READ_WRITE_TOKEN!);
  else if (env.RECEIPT_STORAGE === "postgres") instance = new PostgresStorage();
  else if (env.RECEIPT_STORAGE === "memory") instance = new MemoryStorage();
  else instance = new LocalStorage(env.RECEIPT_LOCAL_DIR ? path.resolve(env.RECEIPT_LOCAL_DIR) : undefined);
  return instance;
}

/** Tests only. */
export function setReceiptStorageForTests(s: ReceiptStorage | undefined) {
  instance = s;
}
