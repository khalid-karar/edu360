/** Arabic-aware normalisation: no diacritics or tatweel, alef/yaa/taa-marbuta variants folded, one space between words. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does the name on a bank account belong to the verified person? Banks often show a shorter name than
 * the government record, so: the shorter name's words must all appear in the longer one, with at least
 * two words, and the first and last words of the shorter name must match the longer name's.
 * Best-effort until a bank name-verification service is connected.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  if (short[0] !== long[0] || short[short.length - 1] !== long[long.length - 1]) return false;
  return short.every((t) => long.includes(t));
}
