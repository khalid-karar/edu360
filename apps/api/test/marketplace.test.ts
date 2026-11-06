import { beforeAll, describe, expect, it } from "vitest";
import { expireStale } from "../src/services/bookings.js";
import { makeHarness } from "./helpers/harness.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let catId: number;
let minorsCatId: number;
let idSeq = 0;
const HOUR = 3_600_000;
const PRICE = 10_000;

beforeAll(async () => {
  h = await makeHarness();
  catId = await h.category("quran", 5000, 20000);
  minorsCatId = catId;
});

/** A unique, mock-valid national ID. The digit after the first picks the gender: even is female, odd is male. */
const nid = (gender: "female" | "male") => `1${gender === "female" ? 2 : 1}${String(++idSeq).padStart(7, "0")}1`;

async function verified(role: "learner" | "guardian" | "teacher", gender: "female" | "male" = "male") {
  const u = await h.signup(role);
  await h.verifyIdentity(u.token, nid(gender));
  return u;
}

/** An approved teacher with one approved category. Vetting itself is covered in onboarding.test.ts. */
async function teacher(opts: { gender?: "female" | "male"; adultsOnly?: boolean } = {}) {
  const t = await verified("teacher", opts.gender ?? "male");
  const r = await h.call("PUT", "/api/teacher/profile", {
    token: t.token,
    body: { bio: "معلم قرآن كريم بإجازة متصلة السند وخبرة عشر سنوات في تعليم الأطفال والكبار.", languages: ["ar"], freelanceDocumentNo: "FL-123456", introVideoKey: `uploads/${t.id}/i.mp4` },
  });
  expect(r.status).toBe(200);
  expect((await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: PRICE }] } })).status).toBe(200);
  await h.db.query("UPDATE teacher_profiles SET status = $2, adults_only = $3 WHERE user_id = $1", [t.id, opts.adultsOnly ? "conditional" : "approved", Boolean(opts.adultsOnly)]);
  await h.db.query("UPDATE teacher_categories SET approved = true WHERE teacher_id = $1", [t.id]);
  return t;
}

/** The start of the given hour, `days` days from the harness clock. */
function at(days: number, hour: number): Date {
  const d = new Date(h.clock.now().getTime() + days * 24 * HOUR);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

async function openWindow(t: { token: string }, days: number, from = 8, to = 14) {
  const r = await h.call("POST", "/api/teacher/availability", { token: t.token, body: { startsAt: at(days, from).toISOString(), endsAt: at(days, to).toISOString() } });
  expect(r.status).toBe(201);
}

/** Books, "pays" through the mock provider and attaches the hold. Returns the booking id. */
async function bookAndPay(buyer: { token: string }, t: { id: string }, start: Date, learnerId?: string) {
  const b = await h.call("POST", "/api/bookings", { token: buyer.token, body: { teacherId: t.id, categoryId: catId, startsAt: start.toISOString(), ...(learnerId ? { learnerId } : {}) } });
  expect(b.status).toBe(201);
  const pay = h.payments.authorize(b.body.amountHalalas, { booking_id: b.body.bookingId });
  const a = await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: buyer.token, body: { paymentId: pay.id } });
  expect(a.status).toBe(200);
  expect(a.body.status).toBe("requested");
  return { id: b.body.bookingId as string, paymentId: pay.id };
}

/** Moves the shared test clock forward to an absolute time (earlier tests have already moved it). */
const goTo = (d: Date) => h.clock.advance(Math.max(0, d.getTime() - h.clock.now().getTime()));
const providerStatus = async (id: string) => (await h.payments.getPayment(id)).status;

describe("guardian: children and teacher approvals", () => {
  it("adds children without a login, enforces age and count limits, and keeps them private to the guardian", async () => {
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const add = (birthYear: number, name = "ولد") => h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: name, birthYear, gender: "male" } });
    expect((await add(year - 3)).status).toBe(422);
    expect((await add(year - 18)).status).toBe(422);
    const ok = await add(year - 9, "سلمان");
    expect(ok.status).toBe(201);
    expect(ok.body.age).toBe(9);
    const row = await h.db.query<{ mobile: string | null; role: string }>("SELECT mobile, role FROM users WHERE id = $1", [ok.body.id]);
    expect(row.rows[0]).toEqual({ mobile: null, role: "minor" });
    for (let i = 0; i < 5; i++) expect((await add(year - 8, `طفل${i}`)).status).toBe(201);
    expect((await add(year - 8, "السابع")).body.error).toBe("too_many_children");

    const other = await verified("guardian");
    expect((await h.call("GET", "/api/guardian/children", { token: other.token })).body.items).toEqual([]);
    expect((await h.call("GET", "/api/guardian/children", { token: g.token })).body.items).toHaveLength(6);
    const learner = await verified("learner");
    expect((await h.call("GET", "/api/guardian/children", { token: learner.token })).status).toBe(403);
  });

  it("approves, lists and withdraws teachers, and refuses adults-only or unknown teachers", async () => {
    const g = await verified("guardian");
    const t = await teacher();
    const adults = await teacher({ adultsOnly: true });
    const put = (teacherId: string, allowCrossGender = false) => h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId, allowCrossGender } });
    expect((await put(t.id, true)).status).toBeLessThan(300);
    expect((await put(adults.id)).status).toBeGreaterThanOrEqual(400);
    expect((await put("00000000-0000-4000-8000-000000000000")).status).toBeGreaterThanOrEqual(400);
    const list = await h.call("GET", "/api/guardian/approvals", { token: g.token });
    expect(list.body.items).toHaveLength(1);
    expect((await h.call("DELETE", `/api/guardian/approvals/${t.id}`, { token: g.token })).status).toBe(200);
    expect((await h.call("GET", "/api/guardian/approvals", { token: g.token })).body.items).toHaveLength(0);
    const log = await h.db.query("SELECT 1 FROM audit_log WHERE actor_id = $1 AND action LIKE 'guardian.%'", [g.id]);
    expect(log.rowCount).toBeGreaterThanOrEqual(2);
  });
});

describe("availability", () => {
  it("accepts aligned windows, rejects bad ones, and does not let windows overlap", async () => {
    const t = await teacher();
    const post = (s: Date, e: Date) => h.call("POST", "/api/teacher/availability", { token: t.token, body: { startsAt: s.toISOString(), endsAt: e.toISOString() } });
    expect((await post(at(2, 8), at(2, 12))).status).toBe(201);
    expect((await post(at(2, 11), at(2, 13))).body.error).toBe("window_overlaps");
    expect((await post(at(3, 8), new Date(at(3, 8).getTime() + 30 * 60_000))).body.error).toBe("bad_window_length");
    expect((await post(new Date(at(3, 8).getTime() + 7 * 60_000), at(3, 12))).body.error).toBe("misaligned_window");
    expect((await post(at(-1, 8), at(-1, 12))).body.error).toBe("in_past");
    expect((await post(at(90, 8), at(90, 12))).body.error).toBe("too_far");
    expect((await h.call("GET", "/api/teacher/availability", { token: t.token })).body.items).toHaveLength(1);
  });

  it("is closed to non-teachers and to teachers who are not approved", async () => {
    const l = await verified("learner");
    expect((await h.call("GET", "/api/teacher/availability", { token: l.token })).status).toBe(403);
    const draft = await verified("teacher");
    const r = await h.call("POST", "/api/teacher/availability", { token: draft.token, body: { startsAt: at(2, 8).toISOString(), endsAt: at(2, 12).toISOString() } });
    expect(r.status).toBe(409);
  });

  it("will not remove a window that has a live booking in it", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    await bookAndPay(l, t, at(2, 9));
    const w = (await h.call("GET", "/api/teacher/availability", { token: t.token })).body.items[0];
    expect((await h.call("DELETE", `/api/teacher/availability/${w.id}`, { token: t.token })).body.error).toBe("window_has_bookings");
  });
});

describe("search and slots", () => {
  it("lists live teachers with their next slot, filters, and never leaks private data", async () => {
    const t = await teacher({ gender: "female" });
    await openWindow(t, 2, 8, 12);
    const draft = await verified("teacher");
    const l = await verified("learner");

    const all = await h.call("GET", "/api/teachers", { token: l.token });
    expect(all.status).toBe(200);
    const mine = all.body.items.find((x: { teacherId: string }) => x.teacherId === t.id);
    expect(mine.nextSlotAt).toBe(at(2, 8).toISOString());
    expect(mine.gender).toBe("female");
    expect(all.body.items.map((x: { teacherId: string }) => x.teacherId)).not.toContain(draft.id);
    const text = JSON.stringify(all.body);
    expect(text).not.toContain(t.phone);
    expect(text).not.toMatch(/iban|national|mobile/i);

    const f = await h.call("GET", `/api/teachers?categoryId=${catId}&gender=female&language=ar&maxPriceHalalas=${PRICE}`, { token: l.token });
    expect(f.body.items.map((x: { teacherId: string }) => x.teacherId)).toContain(t.id);
    const none = await h.call("GET", `/api/teachers?maxPriceHalalas=100`, { token: l.token });
    expect(none.body.items).toEqual([]);
    expect((await h.call("GET", "/api/teachers?language=xx", { token: l.token })).status).toBe(400);
    expect((await h.call("GET", "/api/teachers")).status).toBe(401);
  });

  it("hides adults-only teachers when searching for a child, and shows approval state", async () => {
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const child = (await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "ريم", birthYear: year - 10, gender: "female" } })).body;
    const t = await teacher({ gender: "female" });
    const adults = await teacher({ adultsOnly: true });
    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: t.id } });
    const r = await h.call("GET", `/api/teachers?childId=${child.id}`, { token: g.token });
    const ids = r.body.items.map((x: { teacherId: string }) => x.teacherId);
    expect(ids).toContain(t.id);
    expect(ids).not.toContain(adults.id);
    const mine = r.body.items.find((x: { teacherId: string }) => x.teacherId === t.id);
    expect(mine.forChild).toEqual({ sameGender: true, approved: true, crossGenderApproved: false });
    const stranger = await verified("guardian");
    expect((await h.call("GET", `/api/teachers?childId=${child.id}`, { token: stranger.token })).status).toBe(403);
    const learner = await verified("learner");
    expect((await h.call("GET", `/api/teachers?childId=${child.id}`, { token: learner.token })).status).toBe(403);
  });

  it("slots exclude busy time, and the profile and slots 404 for teachers who are not live", async () => {
    const t = await teacher();
    await openWindow(t, 2, 8, 11);
    const l = await verified("learner");
    const before = (await h.call("GET", `/api/teachers/${t.id}/slots`, { token: l.token })).body.slots as string[];
    expect(before).toContain(at(2, 8).toISOString());
    await bookAndPay(l, t, at(2, 9));
    const after = (await h.call("GET", `/api/teachers/${t.id}/slots`, { token: l.token })).body.slots as string[];
    expect(after).toContain(at(2, 8).toISOString());
    expect(after).not.toContain(at(2, 9).toISOString());
    expect(after).not.toContain(new Date(at(2, 9).getTime() + 30 * 60_000).toISOString());
    expect((await h.call("GET", `/api/teachers/${t.id}`, { token: l.token })).body.teacherId).toBe(t.id);
    const draft = await verified("teacher");
    expect((await h.call("GET", `/api/teachers/${draft.id}`, { token: l.token })).status).toBe(404);
    expect((await h.call("GET", `/api/teachers/${draft.id}/slots`, { token: l.token })).status).toBe(404);
  });
});

describe("booking and payment life cycle", () => {
  it("happy path: hold, teacher accepts, completes, captured with 20% commission, room created", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const start = at(2, 9);
    const b = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: start.toISOString() } });
    expect(b.body).toMatchObject({ status: "awaiting_payment", amountHalalas: PRICE, currency: "SAR" });

    // The teacher cannot see a booking nobody has paid for.
    expect((await h.call("GET", `/api/bookings/${b.body.bookingId}`, { token: t.token })).status).toBe(404);
    expect((await h.call("GET", "/api/bookings", { token: t.token })).body.items).toEqual([]);

    const pay = h.payments.authorize(PRICE, { booking_id: b.body.bookingId });
    const a = await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } });
    expect(a.body.status).toBe("requested");
    // Reporting the same payment twice is harmless.
    expect((await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).toBe(200);

    const tv = await h.call("GET", `/api/bookings/${b.body.bookingId}`, { token: t.token });
    expect(tv.body.status).toBe("requested");
    expect((await h.call("POST", `/api/bookings/${b.body.bookingId}/accept`, { token: l.token })).status).toBe(403);
    const acc = await h.call("POST", `/api/bookings/${b.body.bookingId}/accept`, { token: t.token });
    expect(acc.body.status).toBe("confirmed");
    const room = await h.db.query("SELECT 1 FROM sessions WHERE booking_id = $1", [b.body.bookingId]);
    expect(room.rowCount).toBe(1);

    expect((await h.call("POST", `/api/bookings/${b.body.bookingId}/complete`, { token: t.token })).body.error).toBe("lesson_not_finished");
    goTo(new Date(start.getTime() + 2 * HOUR));
    const done = await h.call("POST", `/api/bookings/${b.body.bookingId}/complete`, { token: t.token });
    expect(done.body.status).toBe("completed");
    expect(await providerStatus(pay.id)).toBe("captured");
    expect(done.body.payment).toMatchObject({ status: "captured", capturedHalalas: PRICE, commissionHalalas: 2000, netHalalas: 8000 });

    // The learner sees what they paid, not the platform's cut.
    const lv = await h.call("GET", `/api/bookings/${b.body.bookingId}`, { token: l.token });
    expect(lv.body.payment).toEqual({ status: "captured", capturedHalalas: PRICE });
    // Another user sees nothing at all.
    const x = await verified("learner");
    expect((await h.call("GET", `/api/bookings/${b.body.bookingId}`, { token: x.token })).status).toBe(404);
  });

  it("the client cannot fake a payment: wrong amount, wrong booking, unknown id, or someone else's booking", async () => {
    const t = await teacher();
    await openWindow(t, 3);
    const l = await verified("learner");
    const b = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(3, 9).toISOString() } });
    const id = b.body.bookingId;
    const pay = (paymentId: string) => h.call("POST", `/api/bookings/${id}/payment`, { token: l.token, body: { paymentId } });
    expect((await pay(h.payments.authorize(PRICE - 100, { booking_id: id }).id)).status).toBe(402);
    expect((await pay(h.payments.authorize(PRICE, { booking_id: "00000000-0000-4000-8000-000000000000" }).id)).status).toBe(402);
    expect((await pay("mock_pay_nope")).status).toBe(404);
    const good = h.payments.authorize(PRICE, { booking_id: id });
    const thief = await verified("learner");
    expect((await h.call("POST", `/api/bookings/${id}/payment`, { token: thief.token, body: { paymentId: good.id } })).status).toBe(404);
    const st = await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [id]);
    expect(st.rows[0]!.status).toBe("awaiting_payment");
    expect((await pay(good.id)).status).toBe(200);
  });

  it("a provider payment cannot back two bookings", async () => {
    const t = await teacher();
    await openWindow(t, 4);
    const l = await verified("learner");
    const first = await bookAndPay(l, t, at(4, 9));
    const b2 = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(4, 11).toISOString() } });
    const r = await h.call("POST", `/api/bookings/${b2.body.bookingId}/payment`, { token: l.token, body: { paymentId: first.paymentId } });
    expect(r.status).toBe(402);
    expect((await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [b2.body.bookingId])).rows[0]!.status).toBe("awaiting_payment");
  });

  it("teacher declines: hold released, nothing charged", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const b = await bookAndPay(l, t, at(2, 12));
    const r = await h.call("POST", `/api/bookings/${b.id}/decline`, { token: t.token });
    expect(r.body.status).toBe("declined");
    expect(await providerStatus(b.paymentId)).toBe("voided");
    // The slot is free again.
    const slots = (await h.call("GET", `/api/teachers/${t.id}/slots`, { token: l.token })).body.slots as string[];
    expect(slots).toContain(at(2, 12).toISOString());
  });

  it("learner cancels a request that is not yet accepted: free", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const b = await bookAndPay(l, t, at(2, 10));
    const r = await h.call("POST", `/api/bookings/${b.id}/cancel`, { token: l.token });
    expect(r.body).toMatchObject({ status: "cancelled", cancelledBy: "learner" });
    expect(await providerStatus(b.paymentId)).toBe("voided");
  });

  it("learner cancels a confirmed lesson inside 24h: teacher keeps 50% less commission; outside 24h: free", async () => {
    const t = await teacher();
    await openWindow(t, 1, 12, 16);
    await openWindow(t, 6, 8, 12);
    const l = await verified("learner");

    const lateStart = at(1, 13);
    const earlyStart = at(6, 9);
    const late = await bookAndPay(l, t, lateStart);
    await h.call("POST", `/api/bookings/${late.id}/accept`, { token: t.token });
    goTo(new Date(lateStart.getTime() - 10 * HOUR));
    const r = await h.call("POST", `/api/bookings/${late.id}/cancel`, { token: l.token });
    expect(r.body.status).toBe("cancelled");
    expect(await providerStatus(late.paymentId)).toBe("captured");
    expect(r.body.payment.capturedHalalas).toBe(PRICE / 2);

    const early = await bookAndPay(l, t, earlyStart);
    await h.call("POST", `/api/bookings/${early.id}/accept`, { token: t.token });
    const e = await h.call("POST", `/api/bookings/${early.id}/cancel`, { token: l.token });
    expect(e.body.status).toBe("cancelled");
    expect(await providerStatus(early.paymentId)).toBe("voided");
  });

  it("teacher cancels a confirmed lesson: the learner pays nothing, whenever it happens", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const b = await bookAndPay(l, t, at(2, 9));
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    const r = await h.call("POST", `/api/bookings/${b.id}/cancel`, { token: t.token });
    expect(r.body).toMatchObject({ status: "cancelled", cancelledBy: "teacher" });
    expect(await providerStatus(b.paymentId)).toBe("voided");
  });

  it("no-show: the learner pays in full when absent; a teacher no-show is a void and costs reliability", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");

    const startA = at(2, 8);
    const startB = at(2, 10);
    const a = await bookAndPay(l, t, startA);
    const b = await bookAndPay(l, t, startB);
    for (const x of [a, b]) await h.call("POST", `/api/bookings/${x.id}/accept`, { token: t.token });

    expect((await h.call("POST", `/api/bookings/${a.id}/no-show`, { token: t.token, body: { absent: "learner" } })).body.error).toBe("too_early");
    goTo(new Date(startB.getTime() + 20 * 60_000)); // 15 minutes of grace have passed for both, and both are inside 24h

    // The wrong party cannot report.
    expect((await h.call("POST", `/api/bookings/${a.id}/no-show`, { token: l.token, body: { absent: "learner" } })).status).toBe(403);
    const before = Number((await h.db.query<{ r: string }>("SELECT reliability_score AS r FROM teacher_profiles WHERE user_id = $1", [t.id])).rows[0]!.r);
    const ln = await h.call("POST", `/api/bookings/${a.id}/no-show`, { token: t.token, body: { absent: "learner" } });
    expect(ln.body).toMatchObject({ status: "no_show_learner" });
    expect(await providerStatus(a.paymentId)).toBe("captured");
    expect(ln.body.payment.capturedHalalas).toBe(PRICE);

    const tn = await h.call("POST", `/api/bookings/${b.id}/no-show`, { token: l.token, body: { absent: "teacher" } });
    expect(tn.body.status).toBe("no_show_teacher");
    expect(await providerStatus(b.paymentId)).toBe("voided");
    const after = Number((await h.db.query<{ r: string }>("SELECT reliability_score AS r FROM teacher_profiles WHERE user_id = $1", [t.id])).rows[0]!.r);
    expect(after).toBeLessThan(before);
  });

  it("commission drops from 20% to 12% after a learner's fifth lesson with the same teacher", async () => {
    const t = await teacher();
    for (let d = 2; d <= 3; d++) await openWindow(t, d, 8, 14);
    const l = await verified("learner");
    const rates: number[] = [];
    const slots = [at(2, 8), at(2, 10), at(2, 12), at(3, 8), at(3, 10), at(3, 12)];
    const made = [];
    for (const s of slots) {
      const b = await bookAndPay(l, t, s);
      await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
      made.push(b);
    }
    goTo(new Date(at(3, 12).getTime() + 2 * HOUR));
    for (const b of made) {
      const r = await h.call("POST", `/api/bookings/${b.id}/complete`, { token: t.token });
      expect(r.status).toBe(200);
      rates.push(r.body.payment.commissionHalalas / PRICE);
    }
    expect(rates).toEqual([0.2, 0.2, 0.2, 0.2, 0.2, 0.12]);
  });
});

describe("races, expiry and booking rules", () => {
  it("two learners racing for the same hour: exactly one gets it", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const a = await verified("learner");
    const b = await verified("learner");
    const body = { teacherId: t.id, categoryId: catId, startsAt: at(2, 9).toISOString() };
    const res = await Promise.all([h.call("POST", "/api/bookings", { token: a.token, body }), h.call("POST", "/api/bookings", { token: b.token, body })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error).toBe("slot_taken");
  });

  it("overlapping starts are refused, back-to-back lessons are fine", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const a = await verified("learner");
    const b = await verified("learner");
    const mk = (u: { token: string }, s: Date) => h.call("POST", "/api/bookings", { token: u.token, body: { teacherId: t.id, categoryId: catId, startsAt: s.toISOString() } });
    expect((await mk(a, at(2, 9))).status).toBe(201);
    expect((await mk(b, new Date(at(2, 9).getTime() + 30 * 60_000))).body.error).toBe("slot_taken");
    expect((await mk(b, at(2, 10))).status).toBe(201);
  });

  it("a learner cannot be in two lessons at once", async () => {
    const t1 = await teacher();
    const t2 = await teacher();
    await openWindow(t1, 2);
    await openWindow(t2, 2);
    const l = await verified("learner");
    const mk = (t: { id: string }) => h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(2, 9).toISOString() } });
    expect((await mk(t1)).status).toBe(201);
    expect((await mk(t2)).body.error).toBe("learner_busy");
  });

  it("validates time rules: outside the window, too soon, too far, misaligned, unknown category, non-live teacher", async () => {
    const t = await teacher();
    await openWindow(t, 2, 8, 12);
    const l = await verified("learner");
    const mk = (startsAt: Date, over: object = {}) => h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: startsAt.toISOString(), ...over } });
    expect((await mk(at(2, 12))).body.error).toBe("slot_unavailable"); // would run past the window
    expect((await mk(at(5, 9))).body.error).toBe("slot_unavailable"); // no window that day
    expect((await mk(new Date(h.clock.now().getTime() + HOUR))).status).toBe(422); // under 2h notice
    expect((await mk(at(30, 9))).status).toBe(422); // beyond 10 days
    expect((await mk(new Date(at(2, 9).getTime() + 5 * 60_000))).body.error).toBe("misaligned_start");
    expect((await mk(at(2, 9), { categoryId: 9999 })).body.error).toBe("category_unavailable");
    const draft = await verified("teacher");
    expect((await mk(at(2, 9), { teacherId: draft.id })).body.error).toBe("teacher_unavailable");
    expect((await mk(at(2, 9), { extra: 1 })).status).toBe(400);
    expect((await h.call("POST", "/api/bookings", { body: {} })).status).toBe(401);
  });

  it("unpaid bookings expire after 15 minutes and free the slot; unanswered requests are declined and released", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const deps = { db: h.db, payments: h.payments, now: h.clock.now };
    await expireStale(deps); // clear leftovers from earlier tests sharing this database
    const unpaid = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(2, 9).toISOString() } });
    const waiting = await bookAndPay(l, t, at(2, 11));

    expect(await expireStale(deps)).toEqual({ cancelled: 0, declined: 0 });
    h.clock.advance(16 * 60_000);
    const swept = await expireStale(deps);
    expect(swept.cancelled).toBe(1);
    expect((await h.db.query<{ status: string; cancelled_by: string }>("SELECT status, cancelled_by FROM bookings WHERE id = $1", [unpaid.body.bookingId])).rows[0]).toEqual({ status: "cancelled", cancelled_by: "system" });

    // Too late to pay a hold that already lapsed.
    const pay = h.payments.authorize(PRICE, { booking_id: unpaid.body.bookingId });
    expect((await h.call("POST", `/api/bookings/${unpaid.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).toBe(402);

    // A request the teacher never answers is released before the lesson.
    const r = await h.db.query<{ expires_at: Date }>("SELECT expires_at FROM bookings WHERE id = $1", [waiting.id]);
    h.clock.advance(Math.max(0, r.rows[0]!.expires_at.getTime() - h.clock.now().getTime()) + 60_000);
    const second = await expireStale(deps);
    expect(second.declined).toBe(1);
    expect(await providerStatus(waiting.paymentId)).toBe("voided");
    // Sweeping again does nothing.
    expect(await expireStale(deps)).toEqual({ cancelled: 0, declined: 0 });
  });

  it("only the right role can book: teachers and staff cannot, and a learner cannot book for someone else's child", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const other = await teacher();
    const body = { teacherId: t.id, categoryId: catId, startsAt: at(2, 9).toISOString() };
    expect((await h.call("POST", "/api/bookings", { token: other.token, body })).status).toBe(403);
    const s = await h.staff("super_admin");
    expect((await h.call("POST", "/api/bookings", { token: s.token, body })).status).toBe(403);
    const l = await verified("learner");
    expect((await h.call("POST", "/api/bookings", { token: l.token, body: { ...body, learnerId: l.id } })).status).toBeLessThan(500);
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const g2 = await verified("guardian");
    const kid = (await h.call("POST", "/api/guardian/children", { token: g2.token, body: { displayName: "ابن", birthYear: year - 9, gender: "male" } })).body;
    expect((await h.call("POST", "/api/bookings", { token: g.token, body: { ...body, learnerId: kid.id } })).body.error).toBe("not_your_child");
    expect((await h.call("POST", "/api/bookings", { token: l.token, body: { ...body, learnerId: kid.id } })).status).toBe(403);
  });
});

describe("children's bookings", () => {
  it("need guardian approval of the teacher; a different-gender teacher needs a separate consent; adults-only teachers are closed", async () => {
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const girl = (await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "نورة", birthYear: year - 8, gender: "female" } })).body;
    const woman = await teacher({ gender: "female" });
    const man = await teacher({ gender: "male" });
    const adults = await teacher({ adultsOnly: true });
    for (const t of [woman, man, adults]) await openWindow(t, 2);

    const mk = (t: { id: string }, hour: number) =>
      h.call("POST", "/api/bookings", { token: g.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(2, hour).toISOString(), learnerId: girl.id } });

    expect((await mk(woman, 9)).body.error).toBe("teacher_not_approved");
    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: woman.id } });
    const ok = await mk(woman, 9);
    expect(ok.status).toBe(201);

    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: man.id } });
    expect((await mk(man, 10)).body.error).toBe("cross_gender_not_approved");
    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: man.id, allowCrossGender: true } });
    expect((await mk(man, 10)).status).toBe(201);

    expect((await mk(adults, 11)).status).toBeGreaterThanOrEqual(400);
  });

  it("the guardian pays and is the one the teacher chats with; the child is listed as the learner", async () => {
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const boy = (await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "يوسف", birthYear: year - 11, gender: "male" } })).body;
    const t = await teacher({ gender: "male" });
    await openWindow(t, 2);
    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: t.id } });
    const b = await bookAndPay(g, t, at(2, 9), boy.id);

    const gv = await h.call("GET", `/api/bookings/${b.id}`, { token: g.token });
    expect(gv.body.learner).toMatchObject({ id: boy.id, displayName: "يوسف", isChild: true });
    const tv = await h.call("GET", `/api/bookings/${b.id}`, { token: t.token });
    expect(tv.body.learner.isChild).toBe(true);
    expect((await h.call("GET", "/api/bookings", { token: g.token })).body.items.map((x: { id: string }) => x.id)).toContain(b.id);

    const msg = await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "السلام عليكم، سنبدأ بمراجعة الحفظ" } });
    expect(msg.status).toBe(201);
    expect((await h.call("GET", `/api/bookings/${b.id}/messages`, { token: g.token })).body.items).toHaveLength(1);

    // Withdrawing approval stops the conversation.
    await h.call("DELETE", `/api/guardian/approvals/${t.id}`, { token: g.token });
    expect((await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "هل أنتم جاهزون؟" } })).status).toBe(403);
  });
});

describe("chat", () => {
  async function confirmed() {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const start = at(2, 9);
    const b = await bookAndPay(l, t, start);
    return { t, l, b, start };
  }

  it("delivers ordinary messages to both sides, in order, and supports polling with ?after", async () => {
    const { t, l, b } = await confirmed();
    const m1 = await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: "السلام عليكم، أرغب بمراجعة سورة الملك" } });
    expect(m1.status).toBe(201);
    h.clock.advance(1000);
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "وعليكم السلام، حياك الله" } });
    const list = await h.call("GET", `/api/bookings/${b.id}/messages`, { token: t.token });
    expect(list.body.items.map((m: { body: string }) => m.body)).toEqual(["السلام عليكم، أرغب بمراجعة سورة الملك", "وعليكم السلام، حياك الله"]);
    const cursor = list.body.items[0].createdAt ?? list.body.items[0].created_at;
    const newer = await h.call("GET", `/api/bookings/${b.id}/messages?after=${encodeURIComponent(new Date(cursor).toISOString())}`, { token: l.token });
    expect(newer.body.items).toHaveLength(1);
  });

  it("blocks contact details, stores the attempt as flagged, and never shows it to the other side", async () => {
    const { t, l, b } = await confirmed();
    const r = await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "كلمني على 0551234567" } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("message_blocked");
    expect(r.body.details.reasons).toContain("phone_number");
    const stored = await h.db.query<{ blocked: boolean }>("SELECT blocked FROM messages WHERE booking_id = $1", [b.id]);
    expect(stored.rows).toEqual([{ blocked: true }]);
    const flag = await h.db.query<{ category: string; severity: number }>("SELECT category, severity FROM flags WHERE target_type = 'message'");
    expect(flag.rows.some((f) => f.category === "leakage")).toBe(true);
    expect((await h.call("GET", `/api/bookings/${b.id}/messages`, { token: l.token })).body.items).toEqual([]);
  });

  it("raises severity for a teacher's attempt toward a child", async () => {
    const g = await verified("guardian");
    const year = h.clock.now().getUTCFullYear();
    const kid = (await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "خالد", birthYear: year - 9, gender: "male" } })).body;
    const t = await teacher();
    await openWindow(t, 2);
    await h.call("POST", "/api/guardian/approvals", { token: g.token, body: { teacherId: t.id } });
    const b = await bookAndPay(g, t, at(2, 9), kid.id);
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "ارسل لي رقمك 0551234567" } });
    const f = await h.db.query<{ severity: number }>(
      "SELECT f.severity FROM flags f JOIN messages m ON m.id::text = f.target_id::text WHERE m.booking_id = $1",
      [b.id],
    );
    expect(f.rows[0]!.severity).toBe(4);
  });

  it("is private to the booking's two parties, closed for unpaid and finished-long-ago bookings, and rate-limited", async () => {
    const { t, l, b, start } = await confirmed();
    const x = await verified("learner");
    expect((await h.call("POST", `/api/bookings/${b.id}/messages`, { token: x.token, body: { body: "مرحبا" } })).status).toBe(404);
    expect((await h.call("GET", `/api/bookings/${b.id}/messages`, { token: x.token })).status).toBe(404);
    expect((await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: "   " } })).status).toBe(400);

    // Unpaid bookings have no chat yet.
    const t2 = await teacher();
    await openWindow(t2, 3);
    const unpaid = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t2.id, categoryId: catId, startsAt: at(3, 9).toISOString() } });
    expect((await h.call("POST", `/api/bookings/${unpaid.body.bookingId}/messages`, { token: l.token, body: { body: "مرحبا" } })).status).toBeGreaterThanOrEqual(400);

    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const r = await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: `رسالة ${i}` } });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);

    // After the lesson is long past the conversation closes.
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    goTo(new Date(start.getTime() + 2 * HOUR));
    await h.call("POST", `/api/bookings/${b.id}/complete`, { token: t.token });
    h.clock.advance(60_000);
    expect((await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: "شكرا جزيلا" } })).status).toBe(201);
    h.clock.advance(8 * 24 * HOUR);
    expect((await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: "سؤال متأخر" } })).body.error).toBe("chat_closed");
  });
});

describe("Moyasar webhook", () => {
  const ev = (type: string, paymentId: string, over: object = {}) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, live: false, secret_token: "whsec_test_secret", data: { id: paymentId }, ...over });

  it("moves a booking to requested from a genuine authorization, even if the client never reports back; repeats are harmless", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const b = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(2, 9).toISOString() } });
    const pay = h.payments.authorize(PRICE, { booking_id: b.body.bookingId });
    const hook = ev("payment_authorized", pay.id);
    expect((await h.call("POST", "/api/webhooks/moyasar", { body: hook })).status).toBe(200);
    expect((await h.call("POST", "/api/webhooks/moyasar", { body: hook })).status).toBe(200);
    expect((await h.call("GET", `/api/bookings/${b.body.bookingId}`, { token: t.token })).body.status).toBe("requested");
    expect((await h.db.query("SELECT 1 FROM payments WHERE booking_id = $1", [b.body.bookingId])).rowCount).toBe(1);
    expect((await h.db.query("SELECT 1 FROM webhook_events WHERE id = $1", [hook.id])).rowCount).toBe(1);
    // Then the client reports the same payment: still fine.
    expect((await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).toBe(200);
  });

  it("trusts the provider, not the webhook body: an event for a payment with the wrong amount changes nothing", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const b = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: catId, startsAt: at(2, 10).toISOString() } });
    const cheap = h.payments.authorize(100, { booking_id: b.body.bookingId });
    expect((await h.call("POST", "/api/webhooks/moyasar", { body: ev("payment_authorized", cheap.id) })).status).toBe(200);
    expect((await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [b.body.bookingId])).rows[0]!.status).toBe("awaiting_payment");
  });

  it("rejects a wrong or missing token, unknown event types and malformed bodies; unknown payments are acknowledged", async () => {
    const hook = (body: unknown) => h.call("POST", "/api/webhooks/moyasar", { body });
    expect((await hook(ev("payment_authorized", "x", { secret_token: "nope" }))).status).toBe(401);
    expect((await hook({ id: "e", type: "payment_authorized", data: { id: "x" } })).status).toBe(401);
    expect((await hook(ev("something_else", "x"))).status).toBe(400);
    expect((await hook({ secret_token: "whsec_test_secret" })).status).toBe(400);
    expect((await hook(ev("payment_authorized", "mock_pay_unknown"))).status).toBe(200);
  });

  it("brings our payment record in line when the provider captured or voided it, without moving the booking", async () => {
    const t = await teacher();
    await openWindow(t, 2);
    const l = await verified("learner");
    const a = await bookAndPay(l, t, at(2, 9));
    await h.payments.capture(a.paymentId, 4000);
    await h.call("POST", "/api/webhooks/moyasar", { body: ev("payment_captured", a.paymentId) });
    const row = await h.db.query<{ status: string; captured_halalas: number }>("SELECT status, captured_halalas FROM payments WHERE psp_reference = $1", [a.paymentId]);
    expect(row.rows[0]).toEqual({ status: "captured", captured_halalas: 4000 });
    expect((await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [a.id])).rows[0]!.status).toBe("requested");
  });

  it("is switched off without a configured secret", async () => {
    const { buildApp } = await import("../src/http/app.js");
    const app = buildApp({ ...h.ctx, config: { ...h.ctx.config, webhookSecret: undefined } });
    const res = await app.inject({ method: "POST", url: "/api/webhooks/moyasar", payload: ev("payment_authorized", "x") });
    expect(res.statusCode).toBe(503);
  });
});
