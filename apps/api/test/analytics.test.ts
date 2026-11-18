import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness, nextPhone } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const read = async () => h.call("GET", "/api/admin/analytics", { token: (await h.staff("super_admin")).token });

describe("who may open it", () => {
  it("is for the super admin only", async () => {
    for (const role of ["vetting_officer", "safety_officer", "finance_officer"]) {
      expect((await h.call("GET", "/api/admin/analytics", { token: (await h.staff(role)).token })).status).toBe(403);
    }
    expect((await h.call("GET", "/api/admin/analytics", { token: (await h.signup("teacher")).token })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/analytics")).status).toBe(401);
  });
});

describe("the numbers", () => {
  it("starts from zero with a full 14-day series, not a gap", async () => {
    const a = (await read()).body;
    expect(a.users.signupsByDay).toHaveLength(14);
    expect(a.bookings30d.completedByDay).toHaveLength(14);
    expect(a.money30d).toMatchObject({ grossHalalas: 0, paidLessons: 0, averageLessonHalalas: 0, refundRate: 0 });
    expect(a.quality30d.averageRating).toBeNull();
    expect(a.waiting.openReports).toBe(0);
    const days = a.users.signupsByDay.map((d: { day: string }) => d.day);
    expect([...days].sort()).toEqual(days); // oldest first
    expect(new Set(days).size).toBe(14);
  });

  it("counts people, the teacher funnel, lessons, money and waiting work", async () => {
    const draft = await h.signup("teacher");
    const t = await m.teacher();
    const l = await m.verified("learner");
    await h.signup("guardian");
    await m.completedLesson(l, t);
    const done = await h.call("GET", "/api/bookings", { token: l.token });
    expect(done.status).toBe(200);

    // Work waiting for people.
    const bookingId = (await h.db.query<{ id: string }>("SELECT id FROM bookings LIMIT 1")).rows[0]!.id;
    await h.db.query("INSERT INTO reports (reporter_id, booking_id, reason) VALUES ($1,$2,'x')", [l.id, bookingId]);
    await h.db.query("INSERT INTO flags (source, target_type, target_id, category, severity) VALUES ('rule','message',$1,'leakage',2)", [randomUUID()]);
    await h.db.query("INSERT INTO disputes (booking_id, opened_by, reason) VALUES ($1,$2,'x')", [bookingId, l.id]);
    await h.call("POST", "/api/schools/apply", { body: { name: "مدرسة الأمل", city: "جدة", contactName: "سلمان", contactMobile: nextPhone() } });
    void draft;

    // Users get the database clock on creation, which in these tests is not the harness clock the report measures against.
    await h.db.query("UPDATE users SET created_at = $1", [h.clock.now()]);
    const a = (await read()).body;
    expect(a.users.newLast7d).toBeGreaterThanOrEqual(4);
    expect(a.users.teachers).toBeGreaterThanOrEqual(2);
    expect(a.users.learners).toBeGreaterThanOrEqual(1);
    expect(a.users.guardians).toBeGreaterThanOrEqual(1);
    expect(a.teacherPipeline.draft).toBeGreaterThanOrEqual(1);
    expect(a.teacherPipeline.approved).toBeGreaterThanOrEqual(1);
    expect(a.bookings30d.byStatus.completed).toBe(1);
    expect(a.bookings30d.completedByDay.at(-1).n).toBe(1);
    expect(a.users.signupsByDay.reduce((s: number, d: { n: number }) => s + d.n, 0)).toBeGreaterThanOrEqual(4);

    const mo = a.money30d;
    expect(mo.paidLessons).toBe(1);
    expect(mo.grossHalalas).toBeGreaterThan(0);
    expect(mo.commissionHalalas).toBeGreaterThan(0);
    expect(mo.commissionHalalas).toBeLessThan(mo.grossHalalas);
    expect(mo.averageLessonHalalas).toBe(mo.grossHalalas);
    expect(mo.refundRate).toBe(0);

    expect(a.waiting).toMatchObject({ openReports: 1, openFlags: 1, openDisputes: 1, pendingSchools: 1, openAppeals: 0 });
    expect(a.schools).toMatchObject({ approved: 0, pending: 1, families: 0 });
  });

  it("reports the refund rate and the average rating", async () => {
    const before = (await read()).body.money30d;
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t, 13);
    await h.db.query("UPDATE payments SET refunded_halalas = captured_halalas / 2 WHERE booking_id = $1", [b.id]);
    await h.db.query("INSERT INTO reviews (booking_id, rating) VALUES ($1, 4)", [b.id]);
    const a = (await read()).body;
    expect(a.money30d.refundedHalalas).toBeGreaterThan(before.refundedHalalas);
    expect(a.money30d.refundRate).toBeGreaterThan(0);
    expect(a.quality30d).toMatchObject({ reviews: 1, averageRating: 4 });
  });

  it("holds aggregates only: no ids, phone numbers or names", async () => {
    const text = JSON.stringify((await read()).body);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(text).not.toMatch(/\+9665\d+/);
    expect(text).not.toContain("displayName");
  });
});
