/**
 * Recipients Capital Q never delivers email to (owner directive 2026-10-16).
 *
 * Test, demo and seed accounts live on reserved names that no real mailbox
 * can have: the RFC 2606 / RFC 6761 special-use top-level domains and the
 * IANA example domains. Delivering to them is never wanted: at best the relay
 * bounces, at worst a typo'd real domain receives it. So the outbound email
 * path records such a message as SUPPRESSED, with this reason, and sends
 * nothing. It is a property of the address, decided at the one sender
 * wrapper, never per caller.
 */

export const RESERVED_TEST_EMAIL_REASON = "RESERVED_TEST_DOMAIN" as const;

const RESERVED_TLDS = ["local", "test", "invalid", "example", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

/**
 * The reserved domain an address is on, or null when it may be delivered.
 * Subdomains count ("x@mail.example.com", "x@fictional.capitalq.local").
 * An address with no domain is not judged here; the sender refuses it.
 */
export function reservedTestEmailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .replace(/[>\s]+$/u, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  if (domain.length === 0) return null;
  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (RESERVED_TLDS.includes(tld)) return domain;
  if (
    RESERVED_DOMAINS.some(
      (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
    )
  ) {
    return domain;
  }
  return null;
}
