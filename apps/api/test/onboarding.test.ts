import { beforeAll, describe, expect, it } from "vitest";
import { CONDUCT_VERSION } from "../src/index.js";
import { makeHarness, makeIban } from "./helpers/harness.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let catId: number;
beforeAll(async () => {
  h = await makeHarness();
  catId = await h.category("quran", 5000, 20000);
});

const NAME = "محمد القحطاني"; // part of the mock government name محمد عبدالله سعد القحطاني

describe("identity (Nafath)", () => {
  it("verifies from the government record, activates the user and keeps no raw national ID", async () => {
    const t = await h.signup("teacher");
    const { start, status } = await h.verifyIdentity(t.token, "1234567891");
    expect(start.body.number).toMatch(/^\d{2}$/);
    expect(status?.body.status).toBe("approved");
    expect((await h.call("GET", "/api/auth/me", { token: t.token })).body.status).toBe("active");

    const row = await h.db.query<Record<string, unknown>>("SELECT * FROM identity_verifications WHERE user_id = $1", [t.id]);
    expect(row.rows[0]!["full_name"]).toBe("محمد عبدالله سعد القحطاني");
    expect(JSON.stringify(row.rows)).not.toContain("1234567891");
    const reqs = await h.db.query("SELECT * FROM nafath_requests WHERE user_id = $1", [t.id]);
    expect(JSON.stringify(reqs.rows)).not.toContain("1234567891");
    const log = await h.db.query("SELECT 1 FROM audit_log WHERE action = 'identity.verified' AND actor_id = $1", [t.id]);
    expect(log.rowCount).toBe(1);
  });

  it("allows one account per person and refuses verifying twice", async () => {
    const a = await h.signup("guardian");
    await h.verifyIdentity(a.token, "1000000021");
    const b = await h.signup("guardian");
    const dup = await h.verifyIdentity(b.token, "1000000021");
    expect(dup.start.status).toBe(409);
    expect(dup.start.body.error).toBe("national_id_in_use");
    const again = await h.verifyIdentity(a.token, "1000000031");
    expect(again.start.body.error).toBe("already_verified");
  });

  it("refuses minors and keeps the user pending", async () => {
    const t = await h.signup("teacher");
    const r = await h.verifyIdentity(t.token, "1000000019"); // ends in 9: a child in the mock
    expect(r.status?.status).toBe(403);
    expect(r.status?.body.error).toBe("underage");
    expect((await h.call("GET", "/api/auth/me", { token: t.token })).body.status).toBe("pending");
  });

  it("reports rejection, and lets nobody poll someone else's request", async () => {
    const t = await h.signup("teacher");
    const rej = await h.verifyIdentity(t.token, "1000000040"); // ends in 0
    expect(rej.status?.body.status).toBe("rejected");
    const owner = await h.signup("guardian");
    const s = await h.call("POST", "/api/identity/nafath/start", { token: owner.token, body: { nationalId: "1000000051" } });
    const thief = await h.signup("guardian");
    expect((await h.call("GET", `/api/identity/nafath/status/${s.body.requestId}`, { token: thief.token })).status).toBe(404);
  });

  it("validates the ID format and rate-limits attempts", async () => {
    const t = await h.signup("teacher");
    expect((await h.call("POST", "/api/identity/nafath/start", { token: t.token, body: { nationalId: "abc" } })).status).toBe(400);
    for (let i = 0; i < 5; i++) {
      expect((await h.call("POST", "/api/identity/nafath/start", { token: t.token, body: { nationalId: `10000001${60 + i}` } })).status).toBe(200);
    }
    expect((await h.call("POST", "/api/identity/nafath/start", { token: t.token, body: { nationalId: "1000000199" } })).status).toBe(429);
  });

  it("is closed to staff and anonymous callers", async () => {
    expect((await h.call("POST", "/api/identity/nafath/start", { body: { nationalId: "1234567891" } })).status).toBe(401);
    const s = await h.staff("super_admin");
    expect((await h.call("POST", "/api/identity/nafath/start", { token: s.token, body: { nationalId: "1234567891" } })).status).toBe(403);
  });
});

/** Walks a teacher through every onboarding step except submitting. */
async function readyTeacher(nationalId: string) {
  const t = await h.signup("teacher", "معلم");
  await h.verifyIdentity(t.token, nationalId);
  const key = (f: string) => `uploads/${t.id}/${f}`;
  const calls = [
    await h.call("PUT", "/api/teacher/profile", {
      token: t.token,
      body: {
        bio: "معلم قرآن كريم بإجازة متصلة السند وخبرة عشر سنوات في تعليم الأطفال والكبار.",
        languages: ["ar"],
        freelanceDocumentNo: "FL-123456",
        introVideoKey: key("intro.mp4"),
      },
    }),
    await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: 10000 }] } }),
    await h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind: "ijazah", fileKey: key("ijazah.pdf") } }),
    await h.call("POST", "/api/teacher/code-of-conduct/sign", { token: t.token, body: { version: CONDUCT_VERSION } }),
    await h.call("PUT", "/api/teacher/payout", { token: t.token, body: { iban: makeIban(), holderName: NAME } }),
  ];
  for (const c of calls) expect([200, 201]).toContain(c.status);
  return { ...t, credentialId: calls[2]!.body.id as string };
}

describe("teacher onboarding", () => {
  it("lists exactly what is missing and refuses to submit an incomplete application", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, "1000000071");
    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.status).toBe("draft");
    expect(me.body.missing).toEqual(expect.arrayContaining(["freelance_document", "bio", "intro_video", "categories", "code_of_conduct", "iban"]));
    const sub = await h.call("POST", "/api/teacher/submit", { token: t.token });
    expect(sub.status).toBe(409);
    expect(sub.body.error).toBe("incomplete");
    expect(sub.body.details.missing).toContain("categories");
  });

  it("submits a complete application and locks it", async () => {
    const t = await readyTeacher("1000000081");
    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.missing).toEqual([]);
    expect(me.body.profile.iban).toBe(`${makeIban().slice(0, 4)}${"•".repeat(16)}${makeIban().slice(-4)}`);
    expect((await h.call("POST", "/api/teacher/submit", { token: t.token })).body.status).toBe("submitted");
    const edit = await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: 6000 }] } });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe("profile_locked");
    expect((await h.call("POST", "/api/teacher/submit", { token: t.token })).status).toBe(409);
  });

  it("enforces category price bands, max three categories and no unknown categories", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, "1000000091".slice(0, 9) + "2");
    const put = (categories: unknown) => h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories } });
    expect((await put([{ categoryId: catId, priceHalalas: 100 }])).body.error).toBe("price_out_of_band");
    expect((await put([{ categoryId: catId, priceHalalas: 99999 }])).body.error).toBe("price_out_of_band");
    expect((await put([{ categoryId: 9999, priceHalalas: 10000 }])).body.error).toBe("unknown_category");
    expect((await put([{ categoryId: catId, priceHalalas: 10000 }, { categoryId: catId, priceHalalas: 10000 }])).body.error).toBe("duplicate_category");
    const four = [1, 2, 3, 4].map((categoryId) => ({ categoryId, priceHalalas: 10000 }));
    expect((await put(four)).status).toBe(400);
    expect((await put([{ categoryId: catId, priceHalalas: 10000 }])).status).toBe(200);
  });

  it("only accepts upload keys that belong to the teacher", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, "1000000102");
    const other = await h.signup("teacher");
    const body = {
      bio: "معلم متمرس وخبرة طويلة في تدريس المواد الدراسية للمراحل المختلفة بطرق حديثة.",
      languages: ["ar"],
      freelanceDocumentNo: "FL-777777",
    };
    for (const bad of [`uploads/${other.id}/intro.mp4`, `uploads/${t.id}/../${other.id}/x.mp4`, "https://evil.example/x.mp4", `other/${t.id}/x.mp4`]) {
      const r = await h.call("PUT", "/api/teacher/profile", { token: t.token, body: { ...body, introVideoKey: bad } });
      expect(r.status).toBe(400);
    }
    const ok = await h.call("PUT", "/api/teacher/profile", { token: t.token, body: { ...body, introVideoKey: `uploads/${t.id}/intro.mp4` } });
    expect(ok.status).toBe(200);
  });

  it("requires credentials in a selected category and the current code of conduct", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, "1000000112");
    const cred = await h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId: catId, kind: "degree", fileKey: `uploads/${t.id}/d.pdf` } });
    expect(cred.body.error).toBe("category_not_selected");
    const old = await h.call("POST", "/api/teacher/code-of-conduct/sign", { token: t.token, body: { version: "2020-old" } });
    expect(old.body.error).toBe("version_outdated");
  });

  it("checks the IBAN checksum and that the account is in the teacher's own name", async () => {
    const t = await h.signup("teacher");
    await h.verifyIdentity(t.token, "1000000122");
    const pay = (iban: string, holderName: string) => h.call("PUT", "/api/teacher/payout", { token: t.token, body: { iban, holderName } });
    expect((await pay("SA0380000000608010167518", NAME)).body.error).toBe("invalid_iban");
    expect((await pay(makeIban(), "خالد العتيبي")).body.error).toBe("iban_name_mismatch");
    const ok = await pay(makeIban().replace(/(.{4})/g, "$1 "), NAME);
    expect(ok.status).toBe(200);
    expect(ok.body.iban).toContain("••••");
    const stored = await h.db.query<{ iban: string }>("SELECT iban FROM teacher_profiles WHERE user_id = $1", [t.id]);
    expect(stored.rows[0]!.iban).toBe(makeIban());
  });

  it("keeps learners and guardians out of teacher routes", async () => {
    const l = await h.signup("learner");
    expect((await h.call("GET", "/api/teacher/me", { token: l.token })).status).toBe(403);
  });
});

describe("vetting", () => {
  const rubric = (k: number, c: number, o: number, t: number) => ({ knowledge: k, communication: c, conduct: o, tech: t });

  it("runs review, interview and decision end to end and writes every step to the audit log", async () => {
    const t = await readyTeacher("1000000132");
    await h.call("POST", "/api/teacher/submit", { token: t.token });
    const officer = await h.staff("vetting_officer");

    const q = await h.call("GET", "/api/admin/vetting/queue", { token: officer.token });
    expect(q.body.items.map((i: { teacherId: string }) => i.teacherId)).toContain(t.id);

    const detail = await h.call("GET", `/api/admin/vetting/teachers/${t.id}`, { token: officer.token });
    expect(detail.body.credentials[0].file_url).toContain(t.id);
    const shown = JSON.stringify(detail.body);
    expect(shown).not.toContain(makeIban()); // no IBAN, national ID or mobile for vetting
    expect(shown).not.toContain("1000000132");

    // Decision before the interview is refused.
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "approved", rubric: rubric(5, 5, 5, 5) } })).body.error).toBe("wrong_status");

    expect((await h.call("POST", `/api/admin/vetting/credentials/${t.credentialId}/review`, { token: officer.token, body: { verdict: "accepted" } })).status).toBe(200);
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/interview`, { token: officer.token })).body.status).toBe("interview");
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/interview`, { token: officer.token })).status).toBe(409);

    const low = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "approved", rubric: rubric(4, 4, 4, 3) } });
    expect(low.status).toBe(422);
    expect(low.body.error).toBe("score_too_low");

    const ok = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "approved", rubric: rubric(4, 4, 4, 4) } });
    expect(ok.body).toMatchObject({ ok: true, decision: "approved", total: 16 });

    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.status).toBe("approved");
    expect(me.body.categories[0].approved).toBe(true);
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "rejected", rubric: rubric(0, 0, 0, 0), reason: "x" } })).body.error).toBe("wrong_status");

    const actions = await h.db.query<{ action: string }>("SELECT action FROM audit_log WHERE target_id = $1 OR detail->>'teacherId' = $1 ORDER BY id", [t.id]);
    expect(actions.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["teacher.submitted", "vetting.credential_reviewed", "vetting.interview_started", "vetting.decision"]),
    );
  });

  it("will not approve without accepted proof, and goes live only for categories with accepted proof", async () => {
    const t = await readyTeacher("1000000142");
    await h.call("POST", "/api/teacher/submit", { token: t.token });
    const officer = await h.staff("vetting_officer");
    await h.call("POST", `/api/admin/vetting/teachers/${t.id}/interview`, { token: officer.token });
    const r = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "approved", rubric: rubric(5, 5, 5, 5) } });
    expect(r.body.error).toBe("no_accepted_credential");
    await h.call("POST", `/api/admin/vetting/credentials/${t.credentialId}/review`, { token: officer.token, body: { verdict: "rejected" } });
    const r2 = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/decision`, { token: officer.token, body: { decision: "approved", rubric: rubric(5, 5, 5, 5) } });
    expect(r2.body.error).toBe("no_accepted_credential");
  });

  it("makes a conditional approval adults-only and demands a stated condition", async () => {
    const t = await readyTeacher("1000000152");
    await h.call("POST", "/api/teacher/submit", { token: t.token });
    const officer = await h.staff("vetting_officer");
    await h.call("POST", `/api/admin/vetting/credentials/${t.credentialId}/review`, { token: officer.token, body: { verdict: "accepted" } });
    await h.call("POST", `/api/admin/vetting/teachers/${t.id}/interview`, { token: officer.token });
    const path = `/api/admin/vetting/teachers/${t.id}/decision`;
    expect((await h.call("POST", path, { token: officer.token, body: { decision: "conditional", rubric: rubric(4, 4, 4, 4) } })).body.error).toBe("reason_required");
    const ok = await h.call("POST", path, { token: officer.token, body: { decision: "conditional", rubric: rubric(4, 4, 4, 4), reason: "بالغون فقط حتى اكتمال المراجعة" } });
    expect(ok.status).toBe(200);
    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.status).toBe("conditional");
    expect(me.body.profile.adultsOnly).toBe(true);
    expect(me.body.lastDecision.reason).toContain("بالغون");
  });

  it("rejects with a reason the teacher can read, and blocks re-applying for 90 days", async () => {
    const t = await readyTeacher("1000000162");
    await h.call("POST", "/api/teacher/submit", { token: t.token });
    const officer = await h.staff("vetting_officer");
    await h.call("POST", `/api/admin/vetting/teachers/${t.id}/interview`, { token: officer.token });
    const path = `/api/admin/vetting/teachers/${t.id}/decision`;
    expect((await h.call("POST", path, { token: officer.token, body: { decision: "rejected", rubric: rubric(1, 1, 1, 1) } })).body.error).toBe("reason_required");
    expect((await h.call("POST", path, { token: officer.token, body: { decision: "rejected", rubric: rubric(1, 1, 1, 1), reason: "ضعف في التمكن من المادة" } })).status).toBe(200);

    const me = await h.call("GET", "/api/teacher/me", { token: t.token });
    expect(me.body.status).toBe("rejected");
    expect(me.body.lastDecision.reason).toBe("ضعف في التمكن من المادة");

    const early = await h.call("POST", "/api/teacher/submit", { token: t.token });
    expect(early.body.error).toBe("reapply_too_soon");
    h.clock.advance(91 * 86_400_000);
    await h.db.query("UPDATE auth_sessions SET expires_at = $2 WHERE user_id = $1", [t.id, new Date(h.clock.now().getTime() + 3_600_000)]); // 91 days outlive a login
    expect((await h.call("POST", "/api/teacher/submit", { token: t.token })).body.status).toBe("submitted");
  });

  it("validates rubric scores", async () => {
    const officer = await h.staff("vetting_officer");
    const id = (await h.signup("teacher")).id;
    for (const bad of [rubric(6, 5, 5, 5), rubric(-1, 5, 5, 5), { knowledge: 5, communication: 5, conduct: 5 }]) {
      const r = await h.call("POST", `/api/admin/vetting/teachers/${id}/decision`, { token: officer.token, body: { decision: "approved", rubric: bad } });
      expect(r.status).toBe(400);
    }
  });

  it("keeps duties separate: only vetting officers can vet", async () => {
    const teacher = await h.signup("teacher");
    for (const role of ["finance_officer", "safety_officer", "super_admin"]) {
      const s = await h.staff(role);
      expect((await h.call("GET", "/api/admin/vetting/queue", { token: s.token })).status).toBe(403);
      expect((await h.call("POST", `/api/admin/vetting/teachers/${teacher.id}/decision`, { token: s.token, body: {} })).status).toBe(403);
    }
    const learner = await h.signup("learner");
    expect((await h.call("GET", "/api/admin/vetting/queue", { token: learner.token })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/vetting/queue", { token: teacher.token })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/vetting/queue")).status).toBe(401);
  });
});

describe("categories and audit log", () => {
  it("lets only a super admin manage categories, and lists active ones publicly", async () => {
    const admin = await h.staff("super_admin");
    const vet = await h.staff("vetting_officer");
    const body = { slug: "math", nameAr: "الرياضيات", nameEn: "Math", minPriceHalalas: 4000, maxPriceHalalas: 15000 };
    expect((await h.call("POST", "/api/admin/categories", { token: vet.token, body })).status).toBe(403);
    const created = await h.call("POST", "/api/admin/categories", { token: admin.token, body });
    expect(created.status).toBe(201);
    expect((await h.call("POST", "/api/admin/categories", { token: admin.token, body })).body.error).toBe("slug_taken");
    expect((await h.call("POST", "/api/admin/categories", { token: admin.token, body: { ...body, slug: "bad", minPriceHalalas: 9000, maxPriceHalalas: 100 } })).body.error).toBe("bad_price_band");

    const patched = await h.call("PATCH", `/api/admin/categories/${created.body.id}`, { token: admin.token, body: { maxPriceHalalas: 20000 } });
    expect(patched.body.maxPriceHalalas).toBe(20000);
    expect((await h.call("PATCH", `/api/admin/categories/${created.body.id}`, { token: admin.token, body: { minPriceHalalas: 30000 } })).body.error).toBe("bad_price_band");
    expect((await h.call("PATCH", `/api/admin/categories/${created.body.id}`, { token: admin.token, body: {} })).status).toBe(400);

    await h.call("PATCH", `/api/admin/categories/${created.body.id}`, { token: admin.token, body: { active: false } });
    const slugs = (await h.call("GET", "/api/categories")).body.items.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("quran");
    expect(slugs).not.toContain("math");
  });

  it("shows the audit log to super admins only, newest first, with paging", async () => {
    const admin = await h.staff("super_admin");
    const vet = await h.staff("vetting_officer");
    expect((await h.call("GET", "/api/admin/audit-log", { token: vet.token })).status).toBe(403);
    const page = await h.call("GET", "/api/admin/audit-log?limit=3", { token: admin.token });
    expect(page.body.items).toHaveLength(3);
    const ids = page.body.items.map((i: { id: number }) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const next = await h.call("GET", `/api/admin/audit-log?limit=3&before=${ids[2]}`, { token: admin.token });
    expect(next.body.items[0].id).toBeLessThan(ids[2]);
    expect((await h.call("GET", "/api/admin/audit-log?limit=500", { token: admin.token })).status).toBe(400);
  });
});

describe("api hygiene", () => {
  it("answers health, 404s cleanly and rejects oversized or broken bodies", async () => {
    expect((await h.call("GET", "/api/health")).body.ok).toBe(true);
    expect((await h.call("GET", "/api/nope")).status).toBe(404);
    const big = await h.app.inject({ method: "POST", url: "/api/auth/otp/request", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "x".repeat(20_000) }) });
    expect(big.statusCode).toBe(413);
    const broken = await h.app.inject({ method: "POST", url: "/api/auth/otp/request", headers: { "content-type": "application/json" }, payload: "{nope" });
    expect(broken.statusCode).toBe(400);
  });
});
