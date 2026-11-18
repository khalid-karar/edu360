import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const chem = { slug: "chemistry", nameAr: "الكيمياء", nameEn: "Chemistry", minPriceHalalas: 3000, maxPriceHalalas: 50000, allowsMinors: true };
const ask = (token: string, name = "الكيمياء", note?: string) => h.call("POST", "/api/teacher/category-requests", { token, body: { name, ...(note ? { note } : {}) } });
const admin = async () => (await h.staff("super_admin")).token;
const decide = async (id: string, body: unknown) => h.call("POST", `/api/admin/category-requests/${id}/decision`, { token: await admin(), body });

describe("asking for a subject", () => {
  it("lets a teacher ask, see their own requests, and not see others'", async () => {
    const t = await m.teacher();
    const other = await m.teacher();
    const r = await ask(t.token, "  الكيمياء   العضوية ", "أدرّسها للثانوي");
    expect(r.status).toBe(201);
    const mine = await h.call("GET", "/api/teacher/category-requests", { token: t.token });
    expect(mine.body.items).toMatchObject([{ id: r.body.id, name: "الكيمياء العضوية", status: "pending" }]);
    expect((await h.call("GET", "/api/teacher/category-requests", { token: other.token })).body.items).toEqual([]);
  });

  it("refuses a subject that already exists, a duplicate waiting request, and more than three waiting", async () => {
    const t = await m.teacher();
    const existing = (await h.db.query<{ name_ar: string }>("SELECT name_ar FROM categories LIMIT 1")).rows[0]!.name_ar;
    expect((await ask(t.token, existing)).body.error).toBe("category_exists");
    expect((await ask(t.token, "الجيولوجيا")).status).toBe(201);
    expect((await ask(t.token, " الجيولوجيا ")).body.error).toBe("already_requested");
    expect((await ask(t.token, "الفلك")).status).toBe(201);
    expect((await ask(t.token, "المنطق")).status).toBe(201);
    expect((await ask(t.token, "الفلسفة")).body.error).toBe("too_many_pending_requests");
  });

  it("is for teachers only and validates the text", async () => {
    const l = await m.verified("learner");
    expect((await ask(l.token)).status).toBe(403);
    expect((await h.call("POST", "/api/teacher/category-requests", { body: { name: "x" } })).status).toBe(401);
    const t = await m.teacher();
    expect((await ask(t.token, "ك")).status).toBe(400);
    expect((await ask(t.token, "x".repeat(61))).status).toBe(400);
    expect((await h.call("POST", "/api/teacher/category-requests", { token: t.token, body: { name: "الأحياء", extra: 1 } })).status).toBe(400);
  });
});

describe("the admin's decision", () => {
  it("is the super admin's alone", async () => {
    for (const role of ["vetting_officer", "safety_officer", "finance_officer"]) {
      const tok = (await h.staff(role)).token;
      expect((await h.call("GET", "/api/admin/category-requests", { token: tok })).status).toBe(403);
      expect((await h.call("POST", "/api/admin/category-requests/00000000-0000-4000-8000-000000000000/decision", { token: tok, body: { decision: "reject", reason: "لا" } })).status).toBe(403);
    }
  });

  it("approving creates the category, closes the request, notifies the teacher, and is audited", async () => {
    const t = await m.verified("teacher"); // a draft: it can still choose subjects
    const r = await ask(t.token, "الكيمياء");
    const queue = await h.call("GET", "/api/admin/category-requests", { token: await admin() });
    expect(queue.body.items.some((x: { id: string; teacherName: string }) => x.id === r.body.id)).toBe(true);
    const d = await decide(r.body.id, { decision: "approve", ...chem });
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ ok: true, status: "approved" });
    const cats = await h.call("GET", "/api/categories");
    expect(cats.body.items.find((c: { slug: string }) => c.slug === "chemistry")).toMatchObject({ nameAr: "الكيمياء", minPriceHalalas: 3000, maxPriceHalalas: 50000 });
    // The teacher can now use it, inside the band.
    const put = await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: d.body.categoryId, priceHalalas: 12000 }] } });
    expect(put.status).toBe(200);
    const n = await h.call("GET", "/api/notifications", { token: t.token });
    expect(JSON.stringify(n.body)).toContain("أضفنا «الكيمياء»");
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'category_request.approved'")).rowCount).toBe(1);
    expect((await h.call("GET", "/api/teacher/category-requests", { token: t.token })).body.items[0].status).toBe("approved");
  });

  it("rejecting needs a reason and tells the teacher why", async () => {
    const t = await m.teacher();
    const r = await ask(t.token, "علم الأبراج");
    expect((await decide(r.body.id, { decision: "reject" })).status).toBe(400);
    expect((await decide(r.body.id, { decision: "reject", reason: "" })).status).toBe(400);
    expect((await decide(r.body.id, { decision: "reject", reason: "ليس علماً معتمداً" })).status).toBe(200);
    const mine = (await h.call("GET", "/api/teacher/category-requests", { token: t.token })).body.items[0];
    expect(mine).toMatchObject({ status: "rejected", rejectReason: "ليس علماً معتمداً" });
    expect(JSON.stringify((await h.call("GET", "/api/notifications", { token: t.token })).body)).toContain("ليس علماً معتمداً");
    // After a rejection the teacher may ask again, and the waiting count has room.
    expect((await ask(t.token, "علم الأبراج")).status).toBe(201);
  });

  it("cannot be decided twice, with a taken slug, or with a backwards band, and a failed approval changes nothing", async () => {
    const t = await m.teacher();
    const r = await ask(t.token, "الإحصاء");
    expect((await decide(r.body.id, { decision: "approve", ...chem, slug: "chemistry" })).body.error).toBe("slug_taken");
    expect((await decide(r.body.id, { decision: "approve", ...chem, slug: "stats", minPriceHalalas: 9000, maxPriceHalalas: 3000 })).body.error).toBe("bad_price_band");
    expect((await h.db.query("SELECT status FROM category_requests WHERE id = $1", [r.body.id])).rows[0]!.status).toBe("pending");
    expect((await decide(r.body.id, { decision: "approve", ...chem, slug: "stats", nameAr: "الإحصاء", nameEn: "Statistics" })).status).toBe(200);
    expect((await decide(r.body.id, { decision: "reject", reason: "متأخر" })).body.error).toBe("already_decided");
    expect((await decide("00000000-0000-4000-8000-000000000000", { decision: "reject", reason: "لا يوجد" })).status).toBe(404);
  });

  it("shows up as work waiting in the admin overview", async () => {
    const t = await m.teacher();
    await ask(t.token, "علم النفس");
    const a = await h.call("GET", "/api/admin/analytics", { token: await admin() });
    expect(a.body.waiting.pendingCategoryRequests).toBeGreaterThanOrEqual(1);
  });
});

describe("an approved teacher adds another subject", () => {
  const vet = async () => (await h.staff("vetting_officer")).token;
  const second = async () => {
    const r = await h.db.query<{ id: number }>("INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas) VALUES ($1,'الفيزياء','Physics',3000,30000) RETURNING id", [`physics-${Math.random().toString(36).slice(2, 8)}`]);
    return r.rows[0]!.id;
  };
  const addProof = async (t: { token: string; id: string }, categoryId: number) => {
    const up = await h.upload(t.token);
    return h.call("POST", "/api/teacher/credentials", { token: t.token, body: { categoryId, kind: "degree", fileKey: up.body.fileKey } });
  };

  it("keeps the new subject hidden until proof is accepted and an officer approves it", async () => {
    const t = await m.teacher();
    const cat = await second();
    expect((await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: cat, priceHalalas: 9000 }] } })).status).toBe(409); // still locked
    const add = await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } });
    expect(add.status).toBe(201);
    const me1 = (await h.call("GET", "/api/teacher/me", { token: t.token })).body;
    expect(me1.categories.find((c: { categoryId: number }) => c.categoryId === cat)).toMatchObject({ approved: false, priceHalalas: 9000 });

    // No proof yet: nothing for the officer to see, and approval is refused.
    let q = (await h.call("GET", "/api/admin/vetting/queue", { token: await vet() })).body;
    expect(q.extra.some((x: { teacherId: string }) => x.teacherId === t.id)).toBe(false);
    const early = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/categories/${cat}/decision`, { token: await vet(), body: { decision: "approve" } });
    expect(early.body.error).toBe("no_accepted_proof");

    const cr = await addProof(t, cat);
    expect(cr.status).toBe(201);
    q = (await h.call("GET", "/api/admin/vetting/queue", { token: await vet() })).body;
    expect(q.extra.find((x: { teacherId: string }) => x.teacherId === t.id)).toMatchObject({ categoryId: cat, pendingCredentials: 1, acceptedCredentials: 0 });

    expect((await h.call("POST", `/api/admin/vetting/credentials/${cr.body.id}/review`, { token: await vet(), body: { verdict: "accepted" } })).status).toBe(200);
    const ok = await h.call("POST", `/api/admin/vetting/teachers/${t.id}/categories/${cat}/decision`, { token: await vet(), body: { decision: "approve" } });
    expect(ok.status).toBe(200);
    const me2 = (await h.call("GET", "/api/teacher/me", { token: t.token })).body;
    expect(me2.categories.find((c: { categoryId: number }) => c.categoryId === cat).approved).toBe(true);
    expect(JSON.stringify((await h.call("GET", "/api/notifications", { token: t.token })).body)).toContain("اعتمدنا «الفيزياء»");
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'vetting.category_decision'")).rowCount).toBeGreaterThanOrEqual(1);
    // Decided once.
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/categories/${cat}/decision`, { token: await vet(), body: { decision: "approve" } })).status).toBe(409);
  });

  it("a rejection removes the subject and its proof, and needs a reason", async () => {
    const t = await m.teacher();
    const cat = await second();
    await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } });
    await addProof(t, cat);
    const tok = await vet();
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/categories/${cat}/decision`, { token: tok, body: { decision: "reject" } })).body.error).toBe("reason_required");
    expect((await h.call("POST", `/api/admin/vetting/teachers/${t.id}/categories/${cat}/decision`, { token: tok, body: { decision: "reject", reason: "الشهادة غير واضحة" } })).status).toBe(200);
    const me = (await h.call("GET", "/api/teacher/me", { token: t.token })).body;
    expect(me.categories.some((c: { categoryId: number }) => c.categoryId === cat)).toBe(false);
    expect(me.credentials.some((c: { categoryId: number }) => c.categoryId === cat)).toBe(false);
    expect(JSON.stringify((await h.call("GET", "/api/notifications", { token: t.token })).body)).toContain("الشهادة غير واضحة");
  });

  it("enforces the band, the cap of three, duplicates, and who may add", async () => {
    const t = await m.teacher();
    const cat = await second();
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 100 } })).body.error).toBe("price_out_of_band");
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: 99999, priceHalalas: 9000 } })).body.error).toBe("unknown_category");
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } })).status).toBe(201);
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } })).body.error).toBe("already_selected");
    const c2 = await second();
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: c2, priceHalalas: 9000 } })).status).toBe(201);
    const c3 = await second();
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: c3, priceHalalas: 9000 } })).body.error).toBe("too_many_categories");
    const draft = await m.verified("teacher");
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: draft.token, body: { categoryId: cat, priceHalalas: 9000 } })).body.error).toBe("not_approved");
    const l = await m.verified("learner");
    expect((await h.call("POST", "/api/teacher/extra-categories", { token: l.token, body: { categoryId: cat, priceHalalas: 9000 } })).status).toBe(403);
  });

  it("lets the teacher withdraw a waiting subject but not remove a live one, and add proof only to a waiting one", async () => {
    const t = await m.teacher();
    const live = (await h.call("GET", "/api/teacher/me", { token: t.token })).body.categories[0].categoryId as number;
    expect((await h.call("DELETE", `/api/teacher/extra-categories/${live}`, { token: t.token })).status).toBe(404);
    expect((await addProof(t, live)).status).toBe(409); // a live subject's proof is closed
    const cat = await second();
    await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } });
    expect((await addProof(t, cat)).status).toBe(201);
    expect((await h.call("DELETE", `/api/teacher/extra-categories/${cat}`, { token: t.token })).status).toBe(200);
    expect((await h.db.query("SELECT 1 FROM credentials WHERE teacher_id = $1 AND category_id = $2", [t.id, cat])).rowCount).toBe(0);
  });

  it("is invisible to learners until approved", async () => {
    const t = await m.teacher();
    const cat = await second();
    await h.call("POST", "/api/teacher/extra-categories", { token: t.token, body: { categoryId: cat, priceHalalas: 9000 } });
    const l = await m.verified("learner");
    const res = await h.call("GET", "/api/teachers", { token: l.token });
    const mine = res.body.items.find((x: { teacherId: string }) => x.teacherId === t.id);
    expect(mine).toBeDefined(); // still listed for the subject they already teach...
    expect(mine.categories.map((c: { categoryId: number }) => c.categoryId)).not.toContain(cat); // ...but not for the one waiting for review
    const page = await h.call("GET", `/api/teachers/${t.id}`, { token: l.token });
    expect(page.body.categories.map((c: { categoryId: number }) => c.categoryId)).not.toContain(cat);
  });
});
