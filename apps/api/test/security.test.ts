import { describe, expect, it } from "vitest";
import { isValidSaudiIban, maskIban, namesMatch, normalizeName } from "../src/index.js";
import { decrypt, encrypt } from "../src/security/crypto.js";
import { base32Encode, totpAt, verifyTotp } from "../src/security/totp.js";
import { makeIban } from "./helpers/harness.js";

describe("totp", () => {
  const rfcSecret = Buffer.from("12345678901234567890"); // RFC 6238 test secret
  it("matches the RFC 6238 vectors", () => {
    expect(totpAt(rfcSecret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(rfcSecret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });
  it("accepts one step of drift, refuses more, and refuses replay", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), now, 0)).toBe(step);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), now, 0)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 2), now, 0)).toBeNull();
    expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), now, step)).toBeNull(); // already used
    expect(verifyTotp(rfcSecret, "12345", now, 0)).toBeNull();
  });
  it("encodes base32 like authenticator apps expect", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("encryption", () => {
  it("round-trips and detects tampering", () => {
    const key = Buffer.alloc(32, 7);
    const blob = encrypt(key, "secret");
    expect(decrypt(key, blob)).toBe("secret");
    expect(blob).not.toContain("secret");
    const [iv, tag, ct] = blob.split(".");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decrypt(key, `${iv}.${tag}.${flipped.toString("base64url")}`)).toThrow();
    expect(() => decrypt(Buffer.alloc(32, 8), blob)).toThrow();
  });
});

describe("iban", () => {
  it("accepts a checksum-valid Saudi IBAN with or without spaces and lower case", () => {
    const iban = makeIban();
    expect(iban).toHaveLength(24);
    expect(isValidSaudiIban(iban)).toBe(true);
    expect(isValidSaudiIban(iban.toLowerCase().replace(/(.{4})/g, "$1 "))).toBe(true);
    expect(isValidSaudiIban("SA0380000000608010167519")).toBe(true); // published example IBAN
  });
  it("rejects wrong checksum, wrong country and wrong length", () => {
    expect(isValidSaudiIban("SA0380000000608010167518")).toBe(false);
    expect(isValidSaudiIban("GB82WEST12345698765432")).toBe(false);
    expect(isValidSaudiIban("SA03800000006080101675")).toBe(false);
    expect(isValidSaudiIban("")).toBe(false);
  });
  it("masks the middle", () => {
    expect(maskIban("SA0380000000608010167519")).toBe("SA03••••••••••••••••7519");
  });
});

describe("name matching", () => {
  const full = "محمد عبدالله سعد القحطاني";
  it("accepts a shorter bank name that is part of the government name", () => {
    expect(namesMatch("محمد القحطاني", full)).toBe(true);
    expect(namesMatch("محمد سعد القحطاني", full)).toBe(true);
    expect(namesMatch(full, full)).toBe(true);
  });
  it("ignores diacritics and alef variants", () => {
    expect(namesMatch("مُحمّد القَحطاني", full)).toBe(true);
    expect(normalizeName("أحمد إبراهيم")).toBe(normalizeName("احمد ابراهيم"));
  });
  it("rejects other people, single names and reordered first or last names", () => {
    expect(namesMatch("خالد القحطاني", full)).toBe(false);
    expect(namesMatch("محمد", full)).toBe(false);
    expect(namesMatch("محمد العتيبي", full)).toBe(false);
    expect(namesMatch("سعد محمد القحطاني", full)).toBe(false);
  });
});
