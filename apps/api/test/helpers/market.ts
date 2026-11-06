import { expect } from "vitest";
import type { makeHarness } from "./harness.js";

type H = Awaited<ReturnType<typeof makeHarness>>;
export const HOUR = 3_600_000;
export const PRICE = 10_000;

/** Shared scenario builders for the marketplace, trust and money tests. Each harness gets its own database. */
export async function makeMarket(h: H) {
  const catId = await h.category("quran", 5000, 20000);
  let idSeq = 0;
  const nid = (gender: "female" | "male") => `1${gender === "female" ? 2 : 1}${String(++idSeq).padStart(7, "0")}1`;

  async function verified(role: "learner" | "guardian" | "teacher", gender: "female" | "male" = "male") {
    const u = await h.signup(role);
    await h.verifyIdentity(u.token, nid(gender));
    return u;
  }

  /** An approved teacher with a bank account and one approved category. `approvedAt` defaults to long ago. */
  async function teacher(opts: { gender?: "female" | "male"; adultsOnly?: boolean; approvedAt?: Date } = {}) {
    const t = await verified("teacher", opts.gender ?? "male");
    const r = await h.call("PUT", "/api/teacher/profile", {
      token: t.token,
      body: { bio: "معلم قرآن كريم بإجازة متصلة السند وخبرة عشر سنوات في تعليم الأطفال والكبار.", languages: ["ar"], freelanceDocumentNo: "FL-123456", introVideoKey: `uploads/${t.id}/i.mp4` },
    });
    expect(r.status).toBe(200);
    expect((await h.call("PUT", "/api/teacher/categories", { token: t.token, body: { categories: [{ categoryId: catId, priceHalalas: PRICE }] } })).status).toBe(200);
    await h.db.query("UPDATE teacher_profiles SET status = $2, adults_only = $3, approved_at = $4, iban = $5, iban_holder_name = $6 WHERE user_id = $1", [
      t.id,
      opts.adultsOnly ? "conditional" : "approved",
      Boolean(opts.adultsOnly),
      opts.approvedAt ?? new Date("2026-01-01T00:00:00Z"),
      "SA0380000000608010167519",
      "محمد القحطاني",
    ]);
    await h.db.query("UPDATE teacher_categories SET approved = true WHERE teacher_id = $1", [t.id]);
    return t;
  }

  const at = (days: number, hour: number) => {
    const d = new Date(h.clock.now().getTime() + days * 24 * HOUR);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const goTo = (d: Date) => h.clock.advance(Math.max(0, d.getTime() - h.clock.now().getTime()));

  async function openWindow(t: { token: string }, days: number, from = 8, to = 14) {
    const r = await h.call("POST", "/api/teacher/availability", { token: t.token, body: { startsAt: at(days, from).toISOString(), endsAt: at(days, to).toISOString() } });
    expect(r.status).toBe(201);
  }

  /** Books and "pays" through the mock provider. */
  async function bookAndPay(buyer: { token: string }, t: { id: string }, start: Date, learnerId?: string) {
    const b = await h.call("POST", "/api/bookings", { token: buyer.token, body: { teacherId: t.id, categoryId: catId, startsAt: start.toISOString(), ...(learnerId ? { learnerId } : {}) } });
    expect(b.status).toBe(201);
    const pay = h.payments.authorize(b.body.amountHalalas, { booking_id: b.body.bookingId });
    const a = await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: buyer.token, body: { paymentId: pay.id } });
    expect(a.status).toBe(200);
    return { id: b.body.bookingId as string, paymentId: pay.id, start };
  }

  /** A lesson that was held and completed: books two days ahead, accepts, moves the clock past the end, completes. */
  async function completedLesson(l: { token: string }, t: { id: string; token: string }, hour = 9) {
    await openWindow(t, 2, 6, 18);
    const start = at(2, hour);
    const b = await bookAndPay(l, t, start);
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    goTo(new Date(start.getTime() + 2 * HOUR));
    const done = await h.call("POST", `/api/bookings/${b.id}/complete`, { token: t.token });
    expect(done.status).toBe(200);
    return b;
  }

  const providerStatus = async (id: string) => (await h.payments.getPayment(id)).status;
  return { catId, verified, teacher, at, goTo, openWindow, bookAndPay, completedLesson, providerStatus };
}
