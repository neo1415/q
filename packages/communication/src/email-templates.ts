import { renderEmail, type RenderedEmail } from "@capital-q/email";

/**
 * The communication context's own emails, on the shared Capital Q layout
 * (DOCS email packet): a reminder the person set, and a notice Q left in
 * the app that is still unread. The meeting email lives with the meeting
 * mailer (schedule/meeting-mail.ts) on the same layout.
 */

/** A reminder the person asked for, due now. */
export function reminderEmail(input: {
  readonly title: string;
  readonly note: string | null;
  readonly origin: string | null;
}): RenderedEmail {
  const title = input.title.replace(/[\r\n]+/g, " ").trim();
  const note = input.note?.trim() ?? "";
  return renderEmail({
    subject: `Reminder: ${title}`,
    preheader:
      note.length > 0 ? note : "The reminder you set on Capital Q is due.",
    heading: title,
    blocks: [
      ...(note.length > 0 ? [{ kind: "paragraph", text: note } as const] : []),
      ...(input.origin === null
        ? [
            {
              kind: "paragraph",
              text: "Open Capital Q to act on it.",
            } as const,
          ]
        : [
            {
              kind: "button",
              label: "Open Capital Q",
              href: `${input.origin}/home`,
            } as const,
          ]),
    ],
    reason: "You're receiving this because you asked Capital Q to remind you.",
    origin: input.origin,
  });
}

/** Something in the app that needs the person and is still unread. */
export function noticeEmail(input: {
  readonly title: string;
  readonly body: string | null;
  /** Absolute link to the place in the app, or null. */
  readonly link: string | null;
  readonly origin: string | null;
}): RenderedEmail {
  const title = input.title.replace(/[\r\n]+/g, " ").trim();
  const body = input.body?.trim() ?? "";
  return renderEmail({
    subject: title,
    preheader: body.length > 0 ? body : "Q needs you on Capital Q.",
    heading: title,
    blocks: [
      ...(body.length > 0 ? [{ kind: "paragraph", text: body } as const] : []),
      ...(input.link === null
        ? [
            {
              kind: "paragraph",
              text: "Open Capital Q to act on it.",
            } as const,
          ]
        : [{ kind: "button", label: "Open it", href: input.link } as const]),
    ],
    reason:
      "You're receiving this because Q needs you and the notice is still unread. Turn these emails off in Settings, Notifications.",
    origin: input.origin,
  });
}
