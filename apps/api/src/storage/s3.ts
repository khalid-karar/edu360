import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorage } from "./storage.js";

export interface S3Options {
  /** Oracle's S3-compatible address: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Object storage over the S3 protocol, which Oracle Object Storage (and most others) speak. The bucket must be private: files are
 * only ever read back through the API, after an owner or staff check, never by a public link. Keys are chosen by the server.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(o: S3Options) {
    this.bucket = o.bucket;
    this.client = new S3Client({
      endpoint: o.endpoint,
      region: o.region,
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      forcePathStyle: true, // Oracle's compatibility endpoint wants the bucket in the path, not the host name
      maxAttempts: 3,
    });
  }

  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentLength: data.length, ServerSideEncryption: undefined }));
  }

  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } });
      if (n.name === "NoSuchKey" || n.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  destroy() {
    this.client.destroy();
  }
}
