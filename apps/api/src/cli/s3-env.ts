import { S3Storage } from "../storage/s3.js";

/** Builds the bucket client from S3_* variables alone, so these tools do not need the app's other secrets. */
export function s3FromEnv(env: NodeJS.ProcessEnv = process.env): { s3: S3Storage; bucket: string } {
  const need = (k: string) => {
    const v = env[k];
    if (!v) {
      console.error(`missing ${k}`);
      process.exit(2);
    }
    return v;
  };
  const bucket = need("S3_BUCKET");
  const s3 = new S3Storage({
    endpoint: need("S3_ENDPOINT"),
    region: env["S3_REGION"] ?? "me-riyadh-1",
    bucket,
    accessKeyId: need("S3_ACCESS_KEY"),
    secretAccessKey: need("S3_SECRET_KEY"),
  });
  return { s3, bucket };
}
