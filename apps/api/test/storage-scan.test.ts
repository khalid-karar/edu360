import { createServer as createHttp, type IncomingMessage } from "node:http";
import { createServer as createTcp, type AddressInfo, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ClamdScanner, type Scanner } from "../src/scan/scanner.js";
import { S3Storage } from "../src/storage/s3.js";
import { makeHarness } from "./helpers/harness.js";

/** A tiny S3 stand-in: path-style PUT / GET / DELETE, and it records the requests so signing can be checked. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const seen: { method: string; url: string; headers: IncomingMessage["headers"] }[] = [];
  const server = createHttp((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers });
      const key = decodeURIComponent(req.url!.split("?")[0]!);
      if (req.method === "PUT") {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"x"' }).end();
      } else if (req.method === "GET") {
        const o = objects.get(key);
        if (!o) return res.writeHead(404, { "content-type": "application/xml" }).end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>no</Message></Error>');
        res.writeHead(200, { "content-length": o.length }).end(o);
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
      } else res.writeHead(405).end();
    });
  });
  return { server, objects, seen };
}

/** A clamd stand-in speaking INSTREAM. `answer` decides the reply for the bytes it received. */
function fakeClamd(answer: (data: Buffer) => string) {
  const received: Buffer[] = [];
  const server = createTcp((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d as Buffer]);
      const head = "zINSTREAM\0";
      if (buf.length < head.length || buf.subarray(0, head.length).toString() !== head) return;
      let off = head.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const n = buf.readUInt32BE(off);
        if (n === 0) break;
        if (buf.length < off + 4 + n) return;
        parts.push(buf.subarray(off + 4, off + 4 + n));
        off += 4 + n;
      }
      const data = Buffer.concat(parts);
      received.push(data);
      sock.end(answer(data) + "\0");
    });
  });
  return { server, received };
}

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

describe("S3 object storage", () => {
  const f = fakeS3();
  let storage: S3Storage;
  beforeAll(async () => {
    const port = await listen(f.server as unknown as Server);
    storage = new S3Storage({ endpoint: `http://127.0.0.1:${port}`, region: "me-riyadh-1", bucket: "ilmak-private", accessKeyId: "AKIATEST", secretAccessKey: "secret" });
  });
  afterAll(() => { storage.destroy(); f.server.close(); });

  it("stores, reads back and deletes, with the bucket in the path and a signed request", async () => {
    const data = Buffer.from("%PDF-1.4 hello");
    await storage.put("uploads/u1/a.pdf", data);
    expect(f.objects.get("/ilmak-private/uploads/u1/a.pdf")).toEqual(data);
    expect(await storage.get("uploads/u1/a.pdf")).toEqual(data);
    await storage.delete("uploads/u1/a.pdf");
    expect(f.objects.size).toBe(0);
    const auth = String(f.seen[0]!.headers.authorization);
    expect(auth).toContain("AWS4-HMAC-SHA256");
    expect(auth).toContain("Credential=AKIATEST/");
    expect(auth).toContain("/me-riyadh-1/s3/aws4_request");
  });

  it("reports a missing object as null, not an error", async () => {
    expect(await storage.get("uploads/none.pdf")).toBeNull();
  });
});

describe("antivirus scanning", () => {
  it("speaks INSTREAM: clean, infected, and an error is not mistaken for clean", async () => {
    const c = fakeClamd((d) => (d.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND" : d.includes("BOOM") ? "INSTREAM size limit exceeded. ERROR" : "stream: OK"));
    const port = await listen(c.server);
    const s = new ClamdScanner("127.0.0.1", port, 2000);
    expect(await s.scan(Buffer.from("%PDF-1.4 fine"))).toEqual({ clean: true });
    expect(await s.scan(Buffer.from("xx EICAR xx"))).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
    await expect(s.scan(Buffer.from("BOOM"))).rejects.toThrow(/clamd said/);
    // A file bigger than one chunk arrives whole.
    const big = Buffer.alloc(200_000, 7);
    await s.scan(big);
    expect(c.received.at(-1)!.equals(big)).toBe(true);
    c.server.close();
  });

  it("throws when nothing is listening or the daemon never answers", async () => {
    const dead = createTcp();
    const port = await listen(dead);
    dead.close();
    await expect(new ClamdScanner("127.0.0.1", port, 500).scan(Buffer.from("x"))).rejects.toBeDefined();
    const mute = createTcp(() => {});
    const p2 = await listen(mute);
    await expect(new ClamdScanner("127.0.0.1", p2, 300).scan(Buffer.from("x"))).rejects.toThrow(/timed out/);
    mute.close();
  });
});

describe("uploads with a scanner configured", () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  beforeAll(async () => {
    h = await makeHarness();
  });
  const ids = { n: 1_100_000_000, next() { return String(this.n += 2); } }; // ids ending in 0 or 9 are rejected by the mock
  const withScanner = (s: Scanner | undefined) => { (h.ctx as { scanner?: Scanner }).scanner = s; };

  it("stores a clean file", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, ids.next());
    withScanner({ scan: async () => ({ clean: true }) });
    expect((await h.upload(t.token)).status).toBe(201);
  });

  it("refuses an infected file and keeps nothing", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, ids.next());
    withScanner({ scan: async () => ({ clean: false, signature: "Test.Virus" }) });
    const before = h.storage.files.size;
    const r = await h.upload(t.token);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("file_infected");
    expect(h.storage.files.size).toBe(before);
    expect((await h.db.query("SELECT 1 FROM uploads WHERE owner_id = $1", [t.id])).rows).toHaveLength(0);
  });

  it("refuses the file when the scanner is down (fail closed)", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, ids.next());
    withScanner({ scan: async () => { throw new Error("connection refused"); } });
    const r = await h.upload(t.token);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("scan_unavailable");
    withScanner(undefined);
  });
});

describe("configuration", () => {
  const base = { DATABASE_URL: "postgres://x", ID_HASH_KEY: "a".repeat(64), MFA_ENC_KEY: "b".repeat(64) };
  it("wants all the S3 values or none", () => {
    expect(() => loadConfig({ ...base, S3_BUCKET: "b" })).toThrow(/S3_ENDPOINT/);
    const c = loadConfig({ ...base, S3_BUCKET: "b", S3_ENDPOINT: "https://ns.compat.objectstorage.me-riyadh-1.oraclecloud.com", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s" });
    expect(c.s3).toMatchObject({ bucket: "b", region: "me-riyadh-1" });
    expect(loadConfig(base).s3).toBeUndefined();
    expect(loadConfig({ ...base, CLAMD_HOST: "127.0.0.1" }).clamd).toEqual({ host: "127.0.0.1", port: 3310 });
  });
});
