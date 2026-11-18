import {
  gateqAnswerSubject,
  reservedTestEmailDomain,
  type GateqOutboundDelivery,
} from "@capital-q/contracts";
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
    /** Where the applicant's answer goes; absent: Capital Q's own sender. */
    readonly replyTo?: string | undefined;
  }) => Promise<void>;
};

export type GateqEmailKind =
  "PASS" | "REPLY" | "CLAIM_CODE" | "APPLICATION_CONTACT_CODE";

/** Outcome per email, for the service log: recipient domain only. */
export type GateqEmailEvent = {
  readonly kind: GateqEmailKind;
  readonly outcome: GateqOutboundDelivery;
  readonly recipientDomain: string | null;
  readonly error?: unknown;
};

export function recipientDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "unknown" : email.slice(at + 1).toLowerCase();
}

/**
 * The firm's answer, word for word, as the founder reads it. The applicant
 * may have no Capital Q account: the footer says why they got it (they
 * applied), that it is a one-to-one message about that application and no
 * list, and where an answer goes. With no reply address it says plainly
 * that replying to this email does not reach the firm.
 */
export function renderGateqAnswerEmail(input: {
  readonly kind: "PASS" | "REPLY";
  readonly fund: string;
  readonly companyName: string;
  readonly reference: string | null;
  readonly body: string;
  /** The subject the person approved; absent: the default for the kind. */
  readonly subject?: string | undefined;
  /** True when the email carries a Reply-To that reaches the firm. */
  readonly repliesReachFirm?: boolean | undefined;
}) {
  const subject =
    input.subject ??
    gateqAnswerSubject({
      kind: input.kind,
      fund: input.fund,
      companyName: input.companyName,
    });
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
      {
        kind: "paragraph",
        text:
          input.repliesReachFirm === true
            ? `Reply to this email to answer ${input.fund} directly.`
            : `Replies to this email don't reach ${input.fund}. To answer, use the contact details on their website.`,
      },
    ],
    reason: `You applied to ${input.fund} through their GateQ link on Capital Q. This is a one-to-one message about that application, not a mailing list: you won't get marketing from it, and if you'd rather not hear more, tell ${input.fund} and they can archive it.`,
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

/**
 * GateQ slice 1: the one-time code that confirms an applicant's email
 * before their application can be submitted. Same layout as the claim code.
 */
export function renderApplicationContactCodeEmail(input: {
  readonly companyName: string;
  readonly code: string;
  readonly expiresInMinutes: number;
}) {
  return renderEmail({
    subject: `Your Capital Q code for ${input.companyName}'s application`,
    preheader: `Enter ${input.code} to confirm your email. It works for ${String(input.expiresInMinutes)} minutes.`,
    heading: `Your code: ${input.code}`,
    blocks: [
      {
        kind: "paragraph",
        text: `Someone using this address is applying for ${input.companyName} through a GateQ link on Capital Q. Enter this code on the application screen; it works for ${String(input.expiresInMinutes)} minutes.`,
      },
      {
        kind: "note",
        text: "Confirming your email lets the investor reach you about this application. It does not create an account or join you to any organisation. If this wasn't you, ignore this email.",
      },
    ],
    reason:
      "This address was entered as the contact for an application to an investor on Capital Q.",
    origin: null,
  });
}

/**
 * Sends one email and reports what became of it; a failure never throws to
 * the caller. A reserved test address (.local, .example, ...) is handed to
 * the sender, whose recording wrapper stops it before any provider, and is
 * reported SUPPRESSED, never SENT.
 */
export async function sendReported(
  sender: GateqOutboundSender | undefined,
  onEmail: ((event: GateqEmailEvent) => void) | undefined,
  kind: GateqEmailKind,
  to: string | null,
  message: {
    readonly subject: string;
    readonly text: string;
    readonly html?: string | undefined;
    readonly fromName?: string | undefined;
    readonly replyTo?: string | undefined;
  },
): Promise<GateqOutboundDelivery> {
  const report = (
    outcome: GateqOutboundDelivery,
    domain: string | null,
    error?: unknown,
  ): GateqOutboundDelivery => {
    onEmail?.({
      kind,
      outcome,
      recipientDomain: domain,
      ...(error === undefined ? {} : { error }),
    });
    return outcome;
  };
  if (to === null || to.trim() === "") return report("NO_ADDRESS", null);
  const domain = recipientDomain(to);
  if (sender === undefined || !sender.available) {
    return report("UNAVAILABLE", domain);
  }
  try {
    await sender.send({ to, ...message });
    return report(
      reservedTestEmailDomain(to) === null ? "SENT" : "SUPPRESSED",
      domain,
    );
  } catch (error: unknown) {
    return report("FAILED", domain, error);
  }
}

/** As sendReported, answering only whether it left (or was stopped as a test address). */
export async function sendLogged(
  ...args: Parameters<typeof sendReported>
): Promise<boolean> {
  const outcome = await sendReported(...args);
  return outcome === "SENT" || outcome === "SUPPRESSED";
}
