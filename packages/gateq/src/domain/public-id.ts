import { randomBytes } from "node:crypto";

import {
  GatewayPublicIdSchema,
  type GatewayPublicId,
} from "../contracts/index.js";

/**
 * The opaque public handle for a gateway (CQ-GATE-001 §4, §19).
 *
 * Enumeration safety is the whole requirement. A sequential id, a slug
 * derived from the organisation's name, or anything else with structure
 * would let somebody walk the list of investors accepting applications and
 * learn who is hiring capital deployment from whom — a competitive fact
 * nobody agreed to publish.
 *
 * 128 bits of randomness in Crockford base32, which is case-insensitive and
 * drops the characters people confuse when reading a code off a QR or a
 * poster. The `gq_` prefix makes it obvious what a stray id is, so it is
 * never mistaken for a session token.
 *
 * It grants nothing. Holding one lets a caller read the published public
 * projection of a published gateway and do nothing else.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function generateGatewayPublicId(): GatewayPublicId {
  const bytes = randomBytes(16);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return GatewayPublicIdSchema.parse(`gq_${out}`);
}
