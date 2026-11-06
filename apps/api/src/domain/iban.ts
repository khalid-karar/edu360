/** Saudi IBAN: SA + 2 check digits + 2-digit bank code + 18 alphanumeric account characters (24 total). */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidSaudiIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^SA\d{4}[A-Z0-9]{18}$/.test(iban)) return false;
  // ISO 13616 mod-97: move the first four characters to the end, letters become 10..35.
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export const maskIban = (iban: string) => `${iban.slice(0, 4)}${"•".repeat(Math.max(0, iban.length - 8))}${iban.slice(-4)}`;
