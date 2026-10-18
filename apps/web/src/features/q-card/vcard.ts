/**
 * vCard 3.0 (RFC 2426) for a Q Card (BIZ-004). 3.0 rather than 4.0 because
 * device support for 4.0 is uneven. Only what the public card shows: the
 * organisation's name, its website and the card URL. A person's email or
 * phone is personal_private and never appears here without an opt-in that
 * does not exist yet.
 */

/** RFC 2426 §4: escape backslash, comma, semicolon and newlines in text values. */
export function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildVCard(card: {
  readonly name: string;
  readonly cardUrl: string;
  readonly websiteUrl: string | null;
  readonly note: string | null;
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardText(card.name)}`,
    // An organisation's card: structured name empty, ORG carries it.
    "N:;;;;",
    `ORG:${escapeVCardText(card.name)}`,
    `URL;TYPE=WORK:${card.cardUrl}`,
    ...(card.websiteUrl === null ? [] : [`URL:${card.websiteUrl}`]),
    ...(card.note === null ? [] : [`NOTE:${escapeVCardText(card.note)}`]),
    "END:VCARD",
  ];
  // RFC 2426 lines end in CRLF.
  return `${lines.join("\r\n")}\r\n`;
}
