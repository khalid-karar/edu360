export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type UploadType = (typeof ALLOWED_TYPES)[number];

export const EXTENSION: Record<UploadType, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** Files kept per person. Credentials are a handful of scans, so this is generous but stops storage abuse. */
export const MAX_UPLOADS_PER_USER = 20;

/**
 * What the bytes really are, from their first bytes. The Content-Type header is only the sender's claim,
 * so a script renamed to .pdf is rejected here.
 */
export function sniffType(b: Buffer): UploadType | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}
