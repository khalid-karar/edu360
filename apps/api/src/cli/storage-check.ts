import { randomBytes } from "node:crypto";
import { s3FromEnv } from "./s3-env.js";

/**
 * Round trip against the real bucket: write, read back, compare, delete, confirm it is gone.
 *   S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... node dist/cli/storage-check.js
 */
const { s3, bucket } = s3FromEnv();
const key = `uploads/_selftest/${Date.now()}-${randomBytes(4).toString("hex")}`;
const data = randomBytes(2048);
try {
  await s3.put(key, data);
  console.log(`1/4 wrote ${data.length} bytes to ${bucket}/${key}`);
  const back = await s3.get(key);
  if (!back || !back.equals(data)) throw new Error("read back different bytes");
  console.log("2/4 read it back, identical");
  await s3.delete(key);
  console.log("3/4 deleted");
  if ((await s3.get(key)) !== null) throw new Error("still there after delete");
  console.log("4/4 confirmed gone\nSTORAGE OK");
} catch (e) {
  console.error("STORAGE FAILED:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exitCode = 1;
} finally {
  s3.destroy();
}
