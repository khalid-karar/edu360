import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Validates untrusted input. Never reads fields the schema does not list. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(
      400,
      "invalid_input",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export const uuidParam = (v: unknown) => parse(z.uuid(), v);

/** Postgres unique_violation, from either driver. */
export const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
