import { renderEmail } from "@capital-q/email";

import type {
  InvitationEmail,
  InvitationMailer,
} from "../application/team-ports.js";

/**
 * The invitation email, in Capital Q's one branded layout, sent through
 * the app's outbound email adapter (Brevo SMTP or API in production). The
 * sender is structural so this package never depends on a provider SDK;
 * tests pass a fake and nothing in a test run can reach a relay.
 */
export type OutboundEmailSender = {
  readonly available: boolean;
  readonly send: (message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string | undefined;
    readonly fromName?: string | undefined;
  }) => Promise<void>;
};

export function renderInvitationEmail(email: InvitationEmail) {
  const article = email.role === "Admin" ? "an" : "a";
  return renderEmail({
    subject: `${email.inviterName} invited you to join ${email.organisationName} on Capital Q`,
    preheader: `Join as ${article} ${email.role}. The link works for ${String(email.expiresInDays)} days.`,
    heading: `Join ${email.organisationName}`,
    blocks: [
      {
        kind: "paragraph",
        text: `${email.inviterName} invited you to join ${email.organisationName} on Capital Q as ${article} ${email.role}. You'll work on the ${email.word}'s relationships, notes and documents together.`,
      },
      ...(email.message === null
        ? []
        : [{ kind: "note" as const, text: `"${email.message}"` }]),
      {
        kind: "button",
        label: `Join ${email.organisationName}`,
        href: email.link,
      },
      {
        kind: "link",
        label: "Or open this link",
        href: email.link,
        showUrl: true,
      },
      {
        kind: "note",
        text: `The link works for ${String(email.expiresInDays)} days, once. Sign in with this email address to accept.`,
      },
    ],
    reason: `${email.inviterName} entered this address to invite you to their ${email.word} on Capital Q.`,
    origin: null,
  });
}

export function createInvitationMailer(
  sender: OutboundEmailSender,
): InvitationMailer {
  return {
    available: sender.available,
    send: async (email) => {
      const rendered = renderInvitationEmail(email);
      await sender.send({
        to: email.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        fromName: `${email.inviterName} via Capital Q`,
      });
    },
  };
}
