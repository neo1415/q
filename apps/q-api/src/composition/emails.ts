import { renderEmail, type RenderedEmail } from "@capital-q/email";

/**
 * The Q API's own emails, on the shared Capital Q layout (DOCS email
 * packet): the calendar invite when both sides agree a call, and the note
 * to Capital Q's operators when Q pauses an account.
 */

/** A call both sides agreed; the .ics travels as an attachment. */
export function callInviteEmail(input: {
  readonly purpose: string;
  readonly when: string;
  readonly timeZone: string;
  readonly origin: string | null;
}): RenderedEmail {
  const purpose = input.purpose.replace(/[\r\n]+/g, " ").trim();
  return renderEmail({
    subject: `Call: ${purpose}`.slice(0, 150),
    preheader: `${input.when} (${input.timeZone}). The calendar invite is attached.`,
    heading: `Your call is agreed: ${purpose}`,
    blocks: [
      {
        kind: "facts",
        rows: [
          { label: "When", value: input.when },
          { label: "Time zone", value: input.timeZone },
          { label: "Where", value: "Video link to follow" },
        ],
      },
      {
        kind: "note",
        text: "The calendar invite is attached (invite.ics): open it to add the call to your calendar. A video link will follow.",
      },
    ],
    reason: "You're receiving this because this call was agreed on Capital Q.",
    origin: input.origin,
  });
}

/** To Capital Q's operators: Q paused a member's account. */
export function accountPausedEmail(input: {
  readonly name: string;
  readonly strikes: number;
  readonly origin: string | null;
}): RenderedEmail {
  const name = input.name.replace(/[\r\n]+/g, " ").trim();
  return renderEmail({
    subject: `Capital Q: Q paused ${name}'s account`,
    preheader: `After ${String(input.strikes)} warnings. Review and reinstate from the admin console.`,
    heading: `Q paused ${name}'s account`,
    blocks: [
      {
        kind: "paragraph",
        text: `Q paused this account after ${String(input.strikes)} warnings about steering onboarding to small talk.`,
      },
      ...(input.origin === null
        ? [
            {
              kind: "paragraph",
              text: "Review it and reinstate it from the admin console.",
            } as const,
          ]
        : [
            {
              kind: "button",
              label: "Review in the admin console",
              href: `${input.origin}/admin`,
            } as const,
          ]),
    ],
    reason:
      "You're receiving this because you are a Capital Q platform operator.",
    origin: input.origin,
  });
}
