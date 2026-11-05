/** Private object storage for receipt images. No provider here ever produces a public URL. */
export interface ReceiptStorage {
  readonly name: string;
  /** Server-side write (used by the local/memory providers and tests). */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Object size in bytes, or null when the object does not exist. */
  size(key: string): Promise<number | null>;
  /** Whole object, or null when missing. Callers must have checked size() against the limit first. */
  read(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}
