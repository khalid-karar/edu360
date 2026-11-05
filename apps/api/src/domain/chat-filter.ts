/**
 * Keeps conversations inside the platform. Blocks phone numbers (digits, Arabic-Indic digits,
 * spelled-out digits), emails, links, handles and "talk to me on another app" messages.
 * Rules only: deliberately simple and explainable. A classifier can sit on top later, but this
 * layer must stay deterministic so it can be tested and audited.
 */

export type BlockReason =
  | "phone_number"
  | "spelled_number"
  | "email"
  | "link"
  | "handle"
  | "external_app"
  | "contact_request";

export interface FilterResult {
  blocked: boolean;
  reasons: BlockReason[];
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)) // Extended Arabic-Indic digits
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "") // zero-width and bidi marks
    .replace(/[ً-ٰٟـ]/g, "") // diacritics and tatweel
    .replace(/[أإآ]/g, "ا")
    .toLowerCase();
}

const SEP = "[\\s.\\-_()]*";
const SAUDI_MOBILE = new RegExp(`(?:(?:\\+|00)?\\s*966${SEP})?0?${SEP}5(?:${SEP}\\d){8}(?!\\d)`);
const LONG_DIGITS = /\d{9,}/;
const SPACED_DIGITS = /(?:\d[\s.\-_]){8,}\d/;

const DIGIT_WORDS = new Set([
  "صفر", "واحد", "واحده", "واحدة", "اثنين", "اثنان", "ثنين", "ثلاثه", "ثلاثة", "ثلاث", "اربعه", "اربعة", "اربع",
  "خمسه", "خمسة", "خمس", "سته", "ستة", "سبعه", "سبعة", "سبع", "ثمانيه", "ثمانية", "ثماني", "تسعه", "تسعة", "تسع",
  "zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
]);
const SPELLED_RUN = 7;

const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9-]+/;
const LINK =
  /https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|sa|me|io|co|app|gl|ly|tv)\b/;
const HANDLE = /(?:^|[\s(])@[a-z0-9_.]{3,}/;

const EXTERNAL_APPS = [
  "واتس", "وتساب", "whatsapp", "whats app", "watsapp", "سناب", "snapchat", "انستا", "instagram", "تيليجرام",
  "تلجرام", "تليجرام", "telegram", "signal", "tiktok", "تيك توك",
];
const CONTACT_REQUESTS = [
  "رقمي", "جوالي", "ايميلي", "كلمني خاص", "خارج المنصه", "خارج المنصة", "my number", "my phone", "call me",
  "text me", "dm me", "outside the platform", "off the platform",
];

export function filterMessage(text: string): FilterResult {
  const s = normalize(text);
  const reasons: BlockReason[] = [];

  if (SAUDI_MOBILE.test(s) || LONG_DIGITS.test(s) || SPACED_DIGITS.test(s)) reasons.push("phone_number");
  if (hasSpelledNumber(s)) reasons.push("spelled_number");
  if (EMAIL.test(s)) reasons.push("email");
  if (LINK.test(s)) reasons.push("link");
  if (HANDLE.test(s)) reasons.push("handle");
  if (EXTERNAL_APPS.some((w) => s.includes(w))) reasons.push("external_app");
  if (CONTACT_REQUESTS.some((w) => s.includes(w))) reasons.push("contact_request");

  return { blocked: reasons.length > 0, reasons };
}

function hasSpelledNumber(s: string): boolean {
  let run = 0;
  for (const token of s.split(/[^\p{L}]+/u)) {
    if (!token) continue;
    run = DIGIT_WORDS.has(token) ? run + 1 : 0;
    if (run >= SPELLED_RUN) return true;
  }
  return false;
}

const CHEATING = [
  "حل الواجب عني", "حل لي الواجب", "حل لي الاختبار", "حل اختباري", "ساعدني في الاختبار", "اكتب لي البحث",
  "do my homework", "solve my test", "take my exam", "write my essay", "exam answers",
];

/** Not blocked, but sent to Trust & Safety review: cheating services are prohibited. */
export function flagCheatingRequest(text: string): boolean {
  const s = normalize(text);
  return CHEATING.some((w) => s.includes(w));
}
