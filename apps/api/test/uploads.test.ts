import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness, MP4, WEBM } from "./helpers/harness.js";
import { MAX_UPLOADS_PER_USER, MAX_VIDEOS_PER_USER } from "../src/domain/uploads.js";
import { LocalDiskStorage } from "../src/storage/storage.js";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let h: Awaited<ReturnType<typeof makeHarness>>;
let catId: number;
beforeAll(async () => {
  h = await makeHarness();
  catId = (await h.category())!;
});

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

async function activeTeacher(id = "1000000121") {
  const t = await h.signup("teacher", "معلم");
  await h.verifyIdentity(t.token, id);
  return t;
}

describe("uploading a file", () => {
  it("stores pdf, png and jpeg under a server-chosen key owned by the teacher", async () => {
    const t = await activeTeacher();
    for (const [data, type, ext] of [[PDF, "application/pdf", "pdf"], [PNG, "image/png", "png"], [JPG, "image/jpeg", "jpg"]] as const) {
      const r = await h.upload(t.token, data, type);
      expect(r.status).toBe(201);
      expect(r.body.fileKey).toMatch(new RegExp(`^uploads/${t.id}/[0-9a-f-]{36}\\.${ext}$`));
      expect(r.body.size).toBe(data.length);
      expect((await h.storage.get(r.body.fileKey))?.equals(data)).toBe(true);
    }
  });

  it("rejects a file whose bytes do not match its claimed type", async () => {
    const t = await activeTeacher("1000000138");
    expect((await h.upload(t.token, Buffer.from("<script>alert(1)</script>"), "application/pdf")).status).toBe(415);
    expect((await h.upload(t.token, PDF, "image/png")).status).toBe(415);
    expect((await h.upload(t.token, PNG, "image/jpeg")).status).toBe(415);
    expect((await h.upload(t.token, Buffer.from("MZ binary"), "application/pdf")).status).toBe(415);
  });

  it("rejects empty files and files over the size limit", async () => {
    const t = await activeTeacher("1000000146");
    expect((await h.upload(t.token, Buffer.alloc(0))).status).toBeGreaterThanOrEqual(400);
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(h.ctx.config.uploadMaxBytes)]);
    expect((await h.upload(t.token, big)).status).toBe(413);
  });

  it("refuses types that are not allowed", async () => {
    const t = await activeTeacher("1000000153");
    expect((await h.upload(t.token, Buffer.from("GIF89a"), "image/gif")).status).toBeGreaterThanOrEqual(400);
    expect((await h.upload(t.token, Buffer.from("x"), "text/html")).status).toBeGreaterThanOrEqual(400);
  });

  it("limits how many files one person keeps", async () => {
    const t = await activeTeacher("1000000161");
    for (let i = 0; i < MAX_UPLOADS_PER_USER; i++) expect((await h.upload(t.token)).status).toBe(201);
    const over = await h.upload(t.token);
    expect(over.status).toBe(422);
    expect(over.body.error).toBe("too_many_uploads");
  });

  it("answers an anonymous or non-teacher caller before reading the body", async () => {
    expect((await h.upload(undefined)).status).toBe(401);
    const l = await h.signup("learner");
    expect((await h.upload(l.token)).status).toBe(403);
  });
});

describe("downloading", () => {
  it("lets the owner fetch the file as an attachment and nobody else", async () => {
    const a = await activeTeacher("1000000178");
    const b = await activeTeacher("1000000187");
    const up = await h.upload(a.token, PNG, "image/png");
    const mine = await h.app.inject({ method: "GET", url: `/api/teacher/uploads/${up.body.id}`, headers: { authorization: `Bearer ${a.token}` } });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["content-type"]).toBe("image/png");
    expect(mine.headers["content-disposition"]).toContain("attachment");
    expect(mine.rawPayload.equals(PNG)).toBe(true);
    const theirs = await h.call("GET", `/api/teacher/uploads/${up.body.id}`, { token: b.token });
    expect(theirs.status).toBe(404);
    expect((await h.call("GET", `/api/teacher/uploads/${up.body.id}`)).status).toBe(401);
  });
});

describe("credentials use uploaded files", () => {
  async function teacherWithCategory(id: string) {
    const t = await activeTeacher(id);
    await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: 10000 }] } });
    return t;
  }

  it("accepts the key returned by an upload", async () => {
    const t = await teacherWithCategory("1000000195");
    const up = await h.upload(t.token);
    const c = await h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind: "degree", fileKey: up.body.fileKey } });
    expect(c.status).toBe(201);
  });

  it("rejects a well-formed key that was never uploaded", async () => {
    const t = await teacherWithCategory("1000000203");
    const c = await h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind: "degree", fileKey: `uploads/${t.id}/made-up.pdf` } });
    expect(c.status).toBe(422);
    expect(c.body.error).toBe("unknown_upload");
  });

  it("rejects another teacher's uploaded file", async () => {
    const a = await teacherWithCategory("1000000211");
    const b = await teacherWithCategory("1000000228");
    const up = await h.upload(a.token);
    const c = await h.call("POST", "/api/teacher/credentials", { token: b.token, body: { categoryId: catId, kind: "degree", fileKey: up.body.fileKey } });
    expect(c.status).toBeGreaterThanOrEqual(400);
    expect(c.status).not.toBe(201);
  });

  it("lets a vetting officer open the scan, writes an audit entry, and keeps other staff out", async () => {
    const t = await teacherWithCategory("1000000237");
    const up = await h.upload(t.token, PNG, "image/png");
    const cred = await h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind: "degree", fileKey: up.body.fileKey } });
    const officer = await h.staff("vetting_officer");
    const r = await h.app.inject({ method: "GET", url: `/api/admin/vetting/credentials/${cred.body.id}/file`, headers: { authorization: `Bearer ${officer.token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(PNG)).toBe(true);
    const log = await h.db.query("SELECT actor_id FROM audit_log WHERE action = 'credential.file_viewed' AND target_id = $1", [cred.body.id]);
    expect(log.rowCount).toBe(1);
    const other = await h.staff("finance_officer");
    expect((await h.call("GET", `/api/admin/vetting/credentials/${cred.body.id}/file`, { token: other.token })).status).toBe(403);
    expect((await h.call("GET", `/api/admin/vetting/credentials/${cred.body.id}/file`, { token: t.token })).status).toBe(403);
  });
});

const BIO = "معلم متمرس وخبرة طويلة في تدريس المواد الدراسية للمراحل المختلفة بطرق حديثة.";
const profile = (extra: Record<string, unknown>) => ({ bio: BIO, languages: ["ar"], freelanceDocumentNo: "FL-777777", ...extra });

describe("videos and the employer letter", () => {
  it("stores mp4, webm and quicktime videos under their own size limit", async () => {
    const t = await activeTeacher("1000000252");
    expect((await h.upload(t.token, MP4, "video/mp4")).body.fileKey).toMatch(/\.mp4$/);
    expect((await h.upload(t.token, WEBM, "video/webm")).body.fileKey).toMatch(/\.webm$/);
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(16)]);
    expect((await h.upload(t.token, mov, "video/quicktime")).body.fileKey).toMatch(/\.mov$/);
  });

  it("allows a video larger than the document limit but not past its own", async () => {
    const t = await activeTeacher("1000000351");
    const { uploadMaxBytes, uploadVideoMaxBytes } = h.ctx.config;
    const sized = (n: number) => Buffer.concat([MP4, Buffer.alloc(n - MP4.length)]);
    expect((await h.upload(t.token, sized(uploadMaxBytes + 1000), "video/mp4")).status).toBe(201);
    expect((await h.upload(t.token, sized(uploadVideoMaxBytes + 1), "video/mp4")).status).toBe(413);
  });

  it("rejects look-alikes: a still image in an mp4 container, or a pdf called a video", async () => {
    const t = await activeTeacher("1000000278");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect((await h.upload(t.token, heic, "video/mp4")).status).toBe(415);
    expect((await h.upload(t.token, PDF, "video/mp4")).status).toBe(415);
    expect((await h.upload(t.token, MP4, "application/pdf")).status).toBe(415);
  });

  it("caps how many videos one teacher keeps, separately from documents", async () => {
    const t = await activeTeacher("1000000286");
    for (let i = 0; i < MAX_VIDEOS_PER_USER; i++) expect((await h.upload(t.token, MP4, "video/mp4")).status).toBe(201);
    const over = await h.upload(t.token, MP4, "video/mp4");
    expect(over.status).toBe(422);
    expect(over.body.error).toBe("too_many_videos");
    expect((await h.upload(t.token)).status).toBe(201);
  });

  it("needs an uploaded video of the right kind on the profile, and keeps it when the key is left out", async () => {
    const t = await activeTeacher("1000000294");
    const put = (body: Record<string, unknown>) => h.call("PUT", "/api/teacher/profile", { token: t.token, body: profile(body) });
    expect((await put({})).body.error).toBe("intro_video_required");
    const pdf = await h.upload(t.token);
    expect((await put({ introVideoKey: pdf.body.fileKey })).body.error).toBe("wrong_file_kind");
    const video = await h.upload(t.token, MP4, "video/mp4");
    expect((await put({ introVideoKey: video.body.fileKey })).status).toBe(200);
    // Saving again without a key keeps the video, so the form need not re-upload.
    expect((await put({})).status).toBe(200);
    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.profile.hasIntroVideo).toBe(true);
    expect(me.body.missing).not.toContain("intro_video");
  });

  it("takes the employer letter as a document, keeps it when omitted and removes it on null", async () => {
    const t = await activeTeacher("1000000302");
    const video = await h.upload(t.token, MP4, "video/mp4");
    const letter = await h.upload(t.token);
    const put = (body: Record<string, unknown>) => h.call("PUT", "/api/teacher/profile", { token: t.token, body: profile({ introVideoKey: video.body.fileKey, ...body }) });
    expect((await put({ employerNocKey: video.body.fileKey })).body.error).toBe("wrong_file_kind");
    expect((await put({ employerNocKey: letter.body.fileKey })).status).toBe(200);
    const has = async () => (await h.call("GET", "/api/teacher/me", { token: t.token })).body.profile.hasEmployerNoc;
    expect(await has()).toBe(true);
    expect((await put({})).status).toBe(200);
    expect(await has()).toBe(true);
    expect((await put({ employerNocKey: null })).status).toBe(200);
    expect(await has()).toBe(false);
  });

  it("only lets a sample-video credential carry a video, and other proof carry a document", async () => {
    const t = await activeTeacher("1000000377");
    await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: 10000 }] } });
    const video = await h.upload(t.token, MP4, "video/mp4");
    const pdf = await h.upload(t.token);
    const add = (kind: string, fileKey: string) => h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind, fileKey } });
    expect((await add("degree", video.body.fileKey)).body.error).toBe("wrong_file_kind");
    expect((await add("sample_video", pdf.body.fileKey)).body.error).toBe("wrong_file_kind");
    expect((await add("sample_video", video.body.fileKey)).status).toBe(201);
  });

  it("lets a vetting officer open the intro video and the letter, audits each view, and keeps others out", async () => {
    const t = await activeTeacher("1000000328");
    const video = await h.upload(t.token, MP4, "video/mp4");
    const letter = await h.upload(t.token, PNG, "image/png");
    await h.call("PUT", "/api/teacher/profile", { token: t.token, body: profile({ introVideoKey: video.body.fileKey, employerNocKey: letter.body.fileKey }) });
    const officer = await h.staff("vetting_officer");
    const get = (path: string, token: string) => h.app.inject({ method: "GET", url: `/api/admin/vetting/teachers/${t.id}/${path}`, headers: { authorization: `Bearer ${token}` } });
    const v = await get("intro-video", officer.token);
    expect(v.statusCode).toBe(200);
    expect(v.headers["content-type"]).toBe("video/mp4");
    expect(v.rawPayload.equals(MP4)).toBe(true);
    expect((await get("employer-noc", officer.token)).rawPayload.equals(PNG)).toBe(true);
    const log = await h.db.query("SELECT action FROM audit_log WHERE target_id = $1 AND action IN ('teacher.intro_video_viewed','teacher.employer_noc_viewed')", [t.id]);
    expect(log.rowCount).toBe(2);
    expect((await get("intro-video", (await h.staff("finance_officer")).token)).statusCode).toBe(403);
    expect((await get("intro-video", t.token)).statusCode).toBe(403);
    // The review screen never receives the raw storage keys.
    const detail = await h.call("GET", `/api/admin/vetting/teachers/${t.id}`, { token: officer.token });
    expect(detail.body.teacher).toMatchObject({ has_intro_video: true, has_employer_noc: true });
    expect(JSON.stringify(detail.body.teacher)).not.toContain("uploads/");
  });
});

describe("erasing an account", () => {
  it("removes the stored files and their records", async () => {
    const t = await activeTeacher("1000000245");
    const up = await h.upload(t.token);
    expect(await h.storage.get(up.body.fileKey)).not.toBeNull();
    const { eraseUser } = await import("../src/services/dataRights.js");
    await eraseUser(h.db, h.clock.now(), t.id, h.storage);
    expect(await h.storage.get(up.body.fileKey)).toBeNull();
    expect((await h.db.query("SELECT 1 FROM uploads WHERE owner_id = $1", [t.id])).rowCount).toBe(0);
  });
});

describe("local disk storage", () => {
  it("stores, reads and deletes, and refuses keys that escape its folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ilmak-store-"));
    try {
      const s = new LocalDiskStorage(dir);
      await s.put("uploads/u1/a.pdf", PDF);
      expect((await s.get("uploads/u1/a.pdf"))?.equals(PDF)).toBe(true);
      expect(await s.get("uploads/u1/missing.pdf")).toBeNull();
      await s.delete("uploads/u1/a.pdf");
      expect(await s.get("uploads/u1/a.pdf")).toBeNull();
      await expect(s.put("../escape.pdf", PDF)).rejects.toThrow();
      await expect(s.get("uploads/../../etc/passwd")).rejects.toThrow();
      expect((await readdir(dir)).includes("escape.pdf")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
