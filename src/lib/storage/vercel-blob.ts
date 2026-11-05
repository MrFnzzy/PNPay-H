import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { ReceiptStorage } from "./types";

/** Vercel Blob with access:'private' - objects are only readable with the server token. */
export class VercelBlobStorage implements ReceiptStorage {
  readonly name = "vercel-blob";
  constructor(private readonly token: string) {}

  async put(key: string, bytes: Buffer, contentType: string) {
    await put(key, bytes, { access: "private", contentType, token: this.token, addRandomSuffix: false, allowOverwrite: false });
  }
  async size(key: string) {
    try {
      const h = await head(key, { token: this.token });
      return h.size;
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  }
  async read(key: string) {
    const res = await get(key, { access: "private", token: this.token, useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  }
  async delete(key: string) {
    await del(key, { token: this.token });
  }
}
