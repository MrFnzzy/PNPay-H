import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ReceiptStorage } from "./types";

/**
 * Stores receipt bytes in the PostgreSQL table receipt_files (bytea). Never produces a public URL;
 * files are only served through the ownership-checked /api/receipts/<id> route.
 */
export class PostgresStorage implements ReceiptStorage {
  readonly name = "postgres";

  async put(key: string, bytes: Buffer, contentType: string) {
    await getDb()
      .insert(schema.receiptFiles)
      .values({ storageKey: key, contentType, sizeBytes: bytes.length, data: bytes })
      .onConflictDoNothing();
  }
  async size(key: string) {
    const [row] = await getDb()
      .select({ n: sql<number>`octet_length(${schema.receiptFiles.data})::int` })
      .from(schema.receiptFiles)
      .where(eq(schema.receiptFiles.storageKey, key));
    return row ? row.n : null;
  }
  async read(key: string) {
    const [row] = await getDb().select({ data: schema.receiptFiles.data }).from(schema.receiptFiles).where(eq(schema.receiptFiles.storageKey, key));
    return row ? Buffer.from(row.data) : null;
  }
  async delete(key: string) {
    await getDb().delete(schema.receiptFiles).where(eq(schema.receiptFiles.storageKey, key));
  }
}
