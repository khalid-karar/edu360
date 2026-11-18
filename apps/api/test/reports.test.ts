import { beforeAll, describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../src/domain/csv.js";
import { makeHarness } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("defuses spreadsheet formulas in text cells, but not in numbers", () => {
    for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tx"]) expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell(-5)).toBe("-5");
  });
  it("starts with a byte order mark so Excel reads Arabic, and ends lines with CRLF", () => {
    const c = toCsv(["أ"], [["ب"]]);
    expect(c.charCodeAt(0)).toBe(0xfeff);
    expect(c).toBe("﻿أ\r\nب\r\n");
  });
});

describe("teacher statement", () => {
  it("lists the month's paid lessons with the platform's cut and the teacher's net, and names no learner", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    const month = h.clock.now().toISOString().slice(0, 7);
    const r = await h.call("GET", `/api/teacher/statement?month=${month}`, { token: t.token });
    expect(r.status).toBe(200);
    expect(r.body.lessons).toHaveLength(1);
    const x = r.body.lessons[0];
    expect(x.bookingId).toBe(b.id);
    expect(x.netHalalas).toBe(x.grossHalalas - x.refundedHalalas - x.commissionHalalas);
    expect(x.commissionHalalas).toBeGreaterThan(0);
    expect(x.payout).toBe("unpaid");
    expect(r.body.totals).toMatchObject({ lessons: 1, netHalalas: x.netHalalas, grossHalalas: x.grossHalalas });
    expect(JSON.stringify(r.body)).not.toContain(l.id);
    expect(JSON.stringify(r.body)).not.toMatch(/\+9665\d+/);
  });

  it("shows only the teacher's own lessons, and an empty month as zeros", async () => {
    const other = await m.teacher();
    const month = h.clock.now().toISOString().slice(0, 7);
    const mine = await h.call("GET", `/api/teacher/statement?month=${month}`, { token: other.token });
    expect(mine.body.lessons).toEqual([]);
    expect(mine.body.totals).toMatchObject({ lessons: 0, netHalalas: 0 });
    const old = await h.call("GET", "/api/teacher/statement?month=2020-01", { token: other.token });
    expect(old.status).toBe(200);
    expect(old.body.totals.lessons).toBe(0);
  });

  it("refuses a malformed month and anyone who is not a teacher", async () => {
    const t = await m.teacher();
    for (const bad of ["2026-13", "2026-1", "x", "2026-11-01"]) expect((await h.call("GET", `/api/teacher/statement?month=${bad}`, { token: t.token })).status).toBe(422);
    const l = await m.verified("learner");
    expect((await h.call("GET", "/api/teacher/statement", { token: l.token })).status).toBe(403);
    expect((await h.call("GET", "/api/teacher/statement")).status).toBe(401);
  });

  it("serves a CSV download with the right headers", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t, 11);
    const month = h.clock.now().toISOString().slice(0, 7);
    const r = await h.call("GET", `/api/teacher/statement?month=${month}&format=csv`, { token: t.token });
    expect(r.status).toBe(200);
    expect(String(r.headers!["content-type"])).toContain("text/csv");
    expect(String(r.headers!["content-disposition"])).toContain(`ilmak-statement-${month}.csv`);
    expect(r.headers!["cache-control"]).toBe("no-store");
    expect(r.text!.split("\r\n").filter(Boolean)).toHaveLength(2); // header + one lesson
  });

  it("counts a lesson in the Riyadh month, not the UTC one", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t, 12);
    // 22:00 UTC on 31 October is 01:00 on 1 November in Riyadh.
    await h.db.query("UPDATE payments SET captured_at = '2031-10-31T22:00:00Z' WHERE booking_id = $1", [b.id]);
    const nov = await h.call("GET", "/api/teacher/statement?month=2031-11", { token: t.token });
    const oct = await h.call("GET", "/api/teacher/statement?month=2031-10", { token: t.token });
    expect(nov.body.totals.lessons).toBe(1);
    expect(oct.body.totals.lessons).toBe(0);
  });
});

describe("finance export", () => {
  const range = () => {
    const d = h.clock.now().toISOString().slice(0, 10);
    return `from=${d}&to=${d}`;
  };

  it("is for finance officers only", async () => {
    for (const role of ["vetting_officer", "safety_officer", "super_admin"]) {
      expect((await h.call("GET", `/api/admin/finance/export?${range()}`, { token: (await h.staff(role)).token })).status).toBe(403);
    }
    expect((await h.call("GET", `/api/admin/finance/export?${range()}`, { token: (await h.signup("teacher")).token })).status).toBe(403);
    expect((await h.call("GET", `/api/admin/finance/export?${range()}`)).status).toBe(401);
  });

  it("exports the range, defuses a teacher name that looks like a formula, and logs who exported", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t, 14);
    await h.db.query("UPDATE users SET display_name = '=HYPERLINK(\"http://x\")' WHERE id = $1", [t.id]);
    await h.db.query("UPDATE payments SET captured_at = $1", [h.clock.now()]);
    const fin = await h.staff("finance_officer");
    const r = await h.call("GET", `/api/admin/finance/export?${range()}`, { token: fin.token });
    expect(r.status).toBe(200);
    expect(r.text!.charCodeAt(0)).toBe(0xfeff);
    expect(r.text!.split("\r\n").filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(r.text).not.toMatch(/(^|,)=HYPERLINK/);
    expect(r.text).toContain("'=HYPERLINK");
    const a = await h.db.query("SELECT actor_id FROM audit_log WHERE action = 'finance.export'");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]!.actor_id).toBe(fin.id);
  });

  it("refuses a bad or oversized range", async () => {
    const fin = await h.staff("finance_officer");
    for (const q of ["from=2026-11-05&to=2026-11-01", "from=x&to=y", "from=2020-01-01&to=2023-01-01", "from=2026-02-30&to=2026-03-01"]) {
      expect((await h.call("GET", `/api/admin/finance/export?${q}`, { token: fin.token })).status, q).toBe(422);
    }
    expect((await h.call("GET", "/api/admin/finance/export", { token: fin.token })).status).toBe(400); // missing dates
  });
});
