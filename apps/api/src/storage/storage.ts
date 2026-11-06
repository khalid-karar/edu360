import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Where uploaded files live. Bytes only: the type, owner and size are in the `uploads` table. */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Tests and the local demo. */
export class MemoryStorage implements ObjectStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, Buffer.from(data));
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

/**
 * Files on the server's disk under one folder. Fine for the test server and a single-machine pilot.
 * For production move to Oracle Object Storage (Riyadh) behind this same interface, private bucket, no public URLs.
 */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }

  /** Refuses any key that would land outside the folder. */
  private path(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error("invalid storage key");
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
