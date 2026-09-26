import { HANDLE_HOLD_DAYS, HandleSchema } from "@capital-q/contracts";

/**
 * Handle rules (BIZ-004), pure.
 *
 * A handle is a display route, never an identifier the system trusts. What
 * a person types is forgiven its case, surrounding space and a leading "@";
 * anything else that does not fit the shape is refused, never corrected
 * into something they did not ask for.
 */

export type HandleReading =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: "SHAPE" };

export function normaliseHandle(raw: string): HandleReading {
  const candidate = raw.trim().replace(/^@/, "").toLowerCase();
  const parsed = HandleSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, handle: parsed.data }
    : { ok: false, reason: "SHAPE" };
}

/** Until when a renamed-away handle redirects and stays unclaimable. */
export function holdUntil(now: Date): Date {
  return new Date(now.getTime() + HANDLE_HOLD_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * What happens to the handle a subject renames away from: a verified
 * organisation's handle is retired and never recycled (people have printed
 * it, linked it and trusted it); anyone else's is held, then released.
 */
export function renamedAwayStatus(verified: boolean): "HELD" | "RETIRED" {
  return verified ? "RETIRED" : "HELD";
}

/** A short, opaque, unguessable code for the card's QR redirect. */
export function newPublicCode(
  randomBytes: (size: number) => Uint8Array,
): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length] ?? "a";
  }
  return code;
}
