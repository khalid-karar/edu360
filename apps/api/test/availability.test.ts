import { describe, expect, it } from "vitest";
import { isAligned, lessonSpan, openSlots, overlaps, slotIsFree, type Span } from "../src/domain/availability.js";

const now = new Date("2026-11-10T10:00:00Z");
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h, m));
const span = (a: Date, b: Date): Span => ({ start: a, end: b });

describe("availability", () => {
  it("treats touching spans as not overlapping", () => {
    expect(overlaps(span(at(12), at(13)), span(at(13), at(14)))).toBe(false);
    expect(overlaps(span(at(12), at(13)), span(at(12, 30), at(14)))).toBe(true);
  });

  it("requires the whole lesson inside one window and clear of bookings", () => {
    const w = [span(at(14), at(17))];
    expect(slotIsFree(lessonSpan(at(14)), w, [])).toBe(true);
    expect(slotIsFree(lessonSpan(at(16, 30)), w, [])).toBe(false); // runs past the window
    expect(slotIsFree(lessonSpan(at(13, 30)), w, [])).toBe(false); // starts before it
    expect(slotIsFree(lessonSpan(at(15)), w, [span(at(15, 30), at(16, 30))])).toBe(false);
    expect(slotIsFree(lessonSpan(at(15)), w, [span(at(16), at(17))])).toBe(true);
  });

  it("lists start times every 15 minutes while a full lesson fits", () => {
    const slots = openSlots([span(at(14), at(16))], [], now);
    expect(slots.map((d) => d.toISOString().slice(11, 16))).toEqual(["14:00", "14:15", "14:30", "14:45", "15:00"]);
  });

  it("skips booked time, and anything under 2 hours away or more than 10 days away", () => {
    const soon = span(at(10), at(13));
    expect(openSlots([soon], [], now)[0]).toEqual(at(12)); // 10:00 + 2h lead
    const far = span(new Date("2026-11-21T10:00:00Z"), new Date("2026-11-21T12:00:00Z"));
    expect(openSlots([far], [], now)).toEqual([]);
    const slots = openSlots([span(at(14), at(17))], [span(at(15), at(16))], now);
    expect(slots.map((d) => d.toISOString().slice(11, 16))).toEqual(["14:00", "16:00"]);
  });

  it("respects the limit and checks alignment", () => {
    expect(openSlots([span(at(14), at(23))], [], now, 3)).toHaveLength(3);
    expect(isAligned(at(14, 15))).toBe(true);
    expect(isAligned(at(14, 10))).toBe(false);
  });
});
