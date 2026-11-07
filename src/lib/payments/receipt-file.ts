/** Content-based image detection. The filename and the client-declared type are never trusted. */
export interface DetectedImage {
  mime: "image/png" | "image/jpeg";
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImage(bytes: Buffer): DetectedImage | null {
  if (bytes.length < 64) return null;
  if (bytes.subarray(0, 8).equals(PNG_SIG)) {
    // First chunk of a PNG must be IHDR with a 13-byte payload.
    if (bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString("ascii") === "IHDR") return { mime: "image/png" };
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // A complete JPEG ends with the EOI marker (trailing padding bytes are tolerated).
    const tail = bytes.subarray(Math.max(0, bytes.length - 64));
    for (let i = tail.length - 2; i >= 0; i--) if (tail[i] === 0xff && tail[i + 1] === 0xd9) return { mime: "image/jpeg" };
    return null;
  }
  return null;
}
