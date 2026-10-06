import { renderEmail } from "@capital-q/email";

/**
 * P14: what a founder receives by email when a firm answers their GateQ
 * application: the exact words a person at the firm approved, in Capital
 * Q's one branded layout. The sender is structural (the app's outbound
 * adapter, Brevo in production); tests pass a fake and nothing in a test
 * reaches a provider.
 */
export type GateqOutboundSender = {
  readonly available: boolean;
  readonly send: (message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string | undefined;
    readonly fromName?: string | undefined;
  }) => Promise<void>;
};

export type GateqEmailKind = "PASS" | "REPLY" | "CLAIM_CODE";

/** Outcome per email, for the service log: recipient domain only. */
export type GateqEmailEvent = {
  readonly kind: GateqEmailKind;
  readonly outcome: "SENT" | "FAILED" | "UNAVAILABLE" | "NO_ADDRESS";
  readonly recipientDomain: string | null;
  readonly error?: unknown;
};

export function recipientDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "unknown" : email.slice(at + 1).toLowerCase();
}

/** The firm's answer, word for word, as the founder reads it. */
export function renderGateqAnswerEmail(input: {
  readonly kind: "PASS" | "REPLY";
  readonly fund: string;
  readonly companyName: string;
  readonly reference: string | null;
  readonly body: string;
}) {
  const subject =
    input.kind === "PASS"
      ? `${input.fund}'s answer on ${input.companyName}`
      : `${input.fund} replied about ${input.companyName}`;
  const paragraphs = input.body
    .split(/\n{2,}/u)
    .map((text) => text.trim())
    .filter((text) => text !== "");
  return renderEmail({
    subject,
    preheader: paragraphs[0]?.slice(0, 120) ?? subject,
    heading:
      input.kind === "PASS"
        ? `An answer from ${input.fund}`
        : `A reply from ${input.fund}`,
    blocks: [
      {
        kind: "paragraph",
        text: `${input.fund} answered your application for ${input.companyName}${input.reference === null ? "" : ` (${input.reference})`} on Capital Q. Their words:`,
      },
      ...paragraphs.map((text) => ({ kind: "note" as const, text })),
    ],
    reason: `You applied to ${input.fund} through their GateQ link on Capital Q.`,
    origin: null,
  });
}

/** P14: the one-time code that proves a work address, for a company claim. */
export function renderClaimCodeEmail(input: {
  readonly companyName: string;
  readonly code: string;
  readonly expiresInMinutes: number;
}) {
  return renderEmail({
    subject: `Your code to claim ${input.companyName} on Capital Q`,
    preheader: `Enter ${input.code} on Capital Q. It works for ${String(input.expiresInMinutes)} minutes.`,
    heading: `Your code: ${input.code}`,
    blocks: [
      {
        kind: "paragraph",
        text: `Someone using this address asked to claim ${input.companyName} on Capital Q. Enter this code on the screen where you asked; it works for ${String(input.expiresInMinutes)} minutes, once.`,
      },
      {
        kind: "note",
        text: "A confirmed work email is evidence for the people who decide the claim; it does not make you a member by itself. If this wasn't you, ignore this email.",
      },
    ],
    reason: `This address was entered to claim ${input.companyName} on Capital Q.`,
    origin: null,
  });
}

/** Sends one email and reports it; a failure never throws to the caller. */
export async function sendLogged(
  sender: GateqOutboundSender | undefined,
  onEmail: ((event: GateqEmailEvent) => void) | undefined,
  kind: GateqEmailKind,
  to: string | null,
  message: {
    readonly subject: string;
    readonly text: string;
    readonly html?: string | undefined;
    readonly fromName?: string | undefined;
  },
): Promise<boolean> {
  if (to === null || to.trim() === "") {
    onEmail?.({ kind, outcome: "NO_ADDRESS", recipientDomain: null });
    return false;
  }
  const domain = recipientDomain(to);
  if (sender === undefined || !sender.available) {
    onEmail?.({ kind, outcome: "UNAVAILABLE", recipientDomain: domain });
    return false;
  }
  try {
    await sender.send({ to, ...message });
    onEmail?.({ kind, outcome: "SENT", recipientDomain: domain });
    return true;
  } catch (error: unknown) {
    onEmail?.({ kind, outcome: "FAILED", recipientDomain: domain, error });
    return false;
  }
}
