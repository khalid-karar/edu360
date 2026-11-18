import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { s3FromEnv } from "./s3-env.js";

/**
 * Copies one file into the bucket under backups/ (used by the nightly backup as its offsite step).
 *   node dist/cli/upload-file.js /var/backups/ilmak/ilmak-db-XXXX.dump
 * The whole file is held in memory while it uploads, which is fine for the pilot's backup sizes.
 */
const path = process.argv[2];
if (!path) {
  console.error("usage: upload-file <file>");
  process.exit(2);
}
const { s3, bucket } = s3FromEnv();
try {
  const data = await readFile(path);
  const key = `backups/${basename(path)}`;
  await s3.put(key, data);
  const back = await s3.get(key);
  if (!back || back.length !== data.length) throw new Error("uploaded copy does not match");
  console.log(`offsite ok: ${bucket}/${key} (${data.length} bytes)`);
} catch (e) {
  console.error("offsite FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  s3.destroy();
}
