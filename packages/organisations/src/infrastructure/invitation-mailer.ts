import { renderEmail } from "@capital-q/email";

import type {
  InvitationEmail,
  InvitationMailer,
  TeamNoticeEmail,
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

/** P15: a request answered, or ownership offered, in the same layout. */
export function renderTeamNoticeEmail(notice: TeamNoticeEmail) {
  const name = notice.organisationName;
  const copy =
    notice.kind === "JOIN_APPROVED"
      ? {
          subject: `You're in: ${name} on Capital Q`,
          heading: `Welcome to ${name}`,
          body: `${notice.actorName} let you in to ${name} on Capital Q. Sign in to work on the ${notice.word}'s relationships, notes and documents together.`,
          label: `Open ${name}`,
          reason: `You asked to join ${name} on Capital Q.`,
        }
      : notice.kind === "JOIN_DECLINED"
        ? {
            subject: `Your request to join ${name}`,
            heading: `About ${name}`,
            body: `${notice.actorName} didn't let you in to ${name} this time. If you think that's a mistake, ask them directly or ask again from Capital Q.`,
            label: "Open Capital Q",
            reason: `You asked to join ${name} on Capital Q.`,
          }
        : {
            subject: `${notice.actorName} offered you ownership of ${name}`,
            heading: `Take over ${name}?`,
            body: `${notice.actorName} offered to make you an owner of ${name} on Capital Q. Nothing changes until you accept it on the Team page.`,
            label: "Review the offer",
            reason: `You are a member of ${name} on Capital Q.`,
          };
  return renderEmail({
    subject: copy.subject,
    preheader: copy.body.slice(0, 120),
    heading: copy.heading,
    blocks: [
      { kind: "paragraph", text: copy.body },
      { kind: "button", label: copy.label, href: notice.link },
    ],
    reason: copy.reason,
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
    notify: async (notice) => {
      const rendered = renderTeamNoticeEmail(notice);
      await sender.send({
        to: notice.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        fromName: `${notice.actorName} via Capital Q`,
      });
    },
  };
}
