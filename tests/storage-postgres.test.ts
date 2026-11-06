import { beforeEach, describe, expect, it } from "vitest";
import { PostgresStorage } from "@/lib/storage/postgres";
import { resetDb } from "./helpers/db";

describe("Postgres receipt storage", () => {
  beforeEach(resetDb);

  it("stores, sizes, reads back identical bytes and deletes (idempotently)", async () => {
    const s = new PostgresStorage();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 0]);
    expect(await s.size("receipts/a/1")).toBeNull();
    expect(await s.read("receipts/a/1")).toBeNull();
    await s.put("receipts/a/1", bytes, "image/png");
    expect(await s.size("receipts/a/1")).toBe(bytes.length);
    expect((await s.read("receipts/a/1"))!.equals(bytes)).toBe(true);
    await s.delete("receipts/a/1");
    await s.delete("receipts/a/1");
    expect(await s.read("receipts/a/1")).toBeNull();
  });

  it("never overwrites an existing key", async () => {
    const s = new PostgresStorage();
    await s.put("receipts/a/2", Buffer.from("first"), "image/png");
    await s.put("receipts/a/2", Buffer.from("second"), "image/png");
    expect((await s.read("receipts/a/2"))!.toString()).toBe("first");
  });
});
