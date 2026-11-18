export const DOC_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ALLOWED_TYPES = [...DOC_TYPES, ...VIDEO_TYPES] as const;
export type UploadType = (typeof ALLOWED_TYPES)[number];

export const EXTENSION: Record<UploadType, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const isVideo = (t: string): boolean => (VIDEO_TYPES as readonly string[]).includes(t);

/** Files kept per person. Credentials are a handful of scans, so this is generous but stops storage abuse. */
export const MAX_UPLOADS_PER_USER = 20;
/** Videos are large, so they are capped separately: an intro video and a couple of sample lessons. */
export const MAX_VIDEOS_PER_USER = 3;

// ISO base media file brands that are video (not HEIC/AVIF images, which share the same container).
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"]);

/**
 * What the bytes really are, from their first bytes. The Content-Type header is only the sender's claim,
 * so a script renamed to .pdf is rejected here.
 */
export function sniffType(b: Buffer): UploadType | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm"; // EBML header
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = b.subarray(8, 12).toString("latin1");
    if (MP4_BRANDS.has(brand)) return "video/mp4";
    if (brand === "qt  ") return "video/quicktime";
  }
  return null;
}
