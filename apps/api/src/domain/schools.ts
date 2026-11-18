import { randomInt } from "node:crypto";

/** No 0/O or 1/I/L: a code is read aloud and typed from a flyer. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const SCHOOL_CODE_RE = /^[A-Z2-9]{8}$/;

export function newSchoolCode(): string {
  let c = "";
  for (let i = 0; i < CODE_LENGTH; i++) c += ALPHABET[randomInt(ALPHABET.length)];
  return c;
}

/**
 * A school sees counts about the families it brought, never who they are. With fewer than this many families a count could point at
 * one household, so the lesson figures stay hidden until the group is big enough.
 */
export const MIN_FAMILIES_FOR_STATS = 5;
