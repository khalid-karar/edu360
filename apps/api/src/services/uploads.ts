import { randomUUID } from "node:crypto";
import { EXTENSION, MAX_UPLOADS_PER_USER, sniffType } from "../domain/uploads.js";
import type { Ctx } from "../http/context.js";
import { HttpError } from "../http/errors.js";

export interface SavedUpload {
  id: string;
  fileKey: string;
  contentType: string;
  size: number;
}

/** Validates and stores one file for a user. The server picks the key, so a client can never name a path. */
export async function saveUpload(ctx: Ctx, userId: string, data: unknown, declaredType: string): Promise<SavedUpload> {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(422, "empty_file");
  if (data.length > ctx.config.uploadMaxBytes) throw new HttpError(413, "too_large");
  const type = sniffType(data);
  if (!type || type !== declaredType.split(";")[0]!.trim().toLowerCase()) throw new HttpError(415, "unsupported_file_type");

  const n = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM uploads WHERE owner_id = $1", [userId]);
  if ((n.rows[0]?.n ?? 0) >= MAX_UPLOADS_PER_USER) throw new HttpError(422, "too_many_uploads");

  const key = `${ctx.config.uploadsPrefix}${userId}/${randomUUID()}.${EXTENSION[type]}`;
  await ctx.storage.put(key, data);
  try {
    const r = await ctx.db.query<{ id: string }>(
      "INSERT INTO uploads (owner_id, key, content_type, size_bytes, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [userId, key, type, data.length, ctx.now()],
    );
    return { id: r.rows[0]!.id, fileKey: key, contentType: type, size: data.length };
  } catch (e) {
    await ctx.storage.delete(key).catch(() => {});
    throw e;
  }
}

/** A stored file by upload id, or null when the row or the bytes are gone. */
export async function readUploadById(ctx: Ctx, id: string, ownerId?: string) {
  const r = await ctx.db.query<{ key: string; content_type: string }>(
    `SELECT key, content_type FROM uploads WHERE id = $1 ${ownerId ? "AND owner_id = $2" : ""}`,
    ownerId ? [id, ownerId] : [id],
  );
  const row = r.rows[0];
  return row ? readUploadByKey(ctx, row.key, row.content_type) : null;
}

export async function readUploadByKey(ctx: Ctx, key: string, contentType: string) {
  const data = await ctx.storage.get(key);
  return data ? { data, contentType } : null;
}
