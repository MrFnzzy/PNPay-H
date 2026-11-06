import type { ReceiptStorage } from "./types";

/** In-memory provider for tests. Supports failure injection. */
export class MemoryStorage implements ReceiptStorage {
  readonly name = "memory";
  readonly objects = new Map<string, Buffer>();
  failNext: { put?: boolean; read?: boolean; delete?: boolean; size?: boolean } = {};

  private maybeFail(op: "put" | "read" | "delete" | "size") {
    if (this.failNext[op]) {
      this.failNext[op] = false;
      throw new Error(`simulated storage ${op} failure`);
    }
  }
  async put(key: string, bytes: Buffer, _contentType?: string) {
    this.maybeFail("put");
    this.objects.set(key, Buffer.from(bytes));
  }
  async size(key: string) {
    this.maybeFail("size");
    return this.objects.get(key)?.length ?? null;
  }
  async read(key: string) {
    this.maybeFail("read");
    const b = this.objects.get(key);
    return b ? Buffer.from(b) : null;
  }
  async delete(key: string) {
    this.maybeFail("delete");
    this.objects.delete(key);
  }
}
