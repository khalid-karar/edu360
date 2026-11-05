import { describe, expect, it } from "vitest";
import { filterMessage, flagCheatingRequest } from "../src/domain/chat-filter.js";

const blocked = (text: string) => filterMessage(text).blocked;

describe("chat filter blocks contact leakage", () => {
  it.each([
    ["Latin digits", "كلمني على 0551234567"],
    ["international format", "+966 55 123 4567"],
    ["00966 prefix", "00966551234567"],
    ["spaced digits", "05 5 123 45 67"],
    ["dashed digits", "055-123-4567"],
    ["Arabic-Indic digits", "٠٥٥١٢٣٤٥٦٧"],
    ["Persian digits", "۰۵۵۱۲۳۴۵۶۷"],
    ["no leading zero", "551234567"],
  ])("phone number: %s", (_name, text) => {
    expect(filterMessage(text).reasons).toContain("phone_number");
  });

  it("spelled-out digits in Arabic and English", () => {
    expect(filterMessage("صفر خمسة خمسة واحد اثنين ثلاثة اربعة خمسة ستة سبعة").reasons).toContain("spelled_number");
    expect(filterMessage("zero five five one two three four five six").reasons).toContain("spelled_number");
  });

  it("emails, links and handles", () => {
    expect(filterMessage("me@example.com").reasons).toContain("email");
    expect(filterMessage("me (at) example").reasons).toContain("email");
    expect(filterMessage("https://wa.me/966551234567").reasons).toContain("link");
    expect(filterMessage("www.something.com").reasons).toContain("link");
    expect(filterMessage("instagram: @teacher_x").reasons).toContain("handle");
  });

  it("other apps and requests to talk elsewhere", () => {
    expect(filterMessage("نكمل على الواتساب؟").reasons).toContain("external_app");
    expect(filterMessage("add me on snapchat").reasons).toContain("external_app");
    expect(filterMessage("خلنا نتكلم خارج المنصة").reasons).toContain("contact_request");
    expect(filterMessage("here is my number").reasons).toContain("contact_request");
  });

  it("sees through zero-width characters and diacritics", () => {
    expect(blocked("وا​تس‍اب")).toBe(true);
    expect(blocked("0​5​5​1​2​3​4​5​6​7")).toBe(true);
    expect(blocked("وَاتْسَاب")).toBe(true);
  });
});

describe("chat filter lets normal lesson talk through", () => {
  it.each([
    "الدرس الساعة 5 مساء",
    "سنراجع الصفحات من 12 الى 45",
    "الواجب صفحة 25 حتى 40",
    "السعر 150 ريال للساعة",
    "Please read page 255 and 256 before class",
    "Lesson on 2026-11-12 at 14:30",
    "احتاج ثلاث ورقات وقلم",
    "I will send homework (3 pages) tonight",
    "ممتاز، نراك غدا ان شاء الله",
  ])("allows: %s", (text) => {
    expect(filterMessage(text)).toEqual({ blocked: false, reasons: [] });
  });
});

describe("cheating requests are flagged for review", () => {
  it("flags", () => {
    expect(flagCheatingRequest("ممكن تحل الواجب عني؟")).toBe(true);
    expect(flagCheatingRequest("can you take my exam for me")).toBe(true);
  });
  it("does not flag normal homework help", () => {
    expect(flagCheatingRequest("ممكن نراجع الواجب مع بعض؟")).toBe(false);
  });
});
