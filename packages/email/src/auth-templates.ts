import { EMAIL_COLOURS, escapeHtml, renderEmail } from "./index.js";

/**
 * The sign-in emails Supabase Auth sends for Capital Q (confirm sign-up,
 * magic link, password reset, email change, invite), on the same layout
 * (DOCS email packet). Supabase fills `{{ .ConfirmationURL }}` itself, so
 * the button here carries the template placeholder rather than a URL this
 * code could check. Written to supabase/templates/*.html by the test that
 * keeps them in step (test/auth-templates.test.ts).
 */

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const URL_PLACEHOLDER = "{{ .ConfirmationURL }}";

/** The typed code (step-up "confirm it's you" verifies it with verifyOtp). */
function codeBlock(): string {
  const C = EMAIL_COLOURS.light;
  return `<p class="cq-secondary" style="margin:0 0 8px;font:14px/22px ${FONT};color:${C.secondary}">Or enter this code:</p><p class="cq-text cq-subtle" style="margin:0 0 24px;padding:12px 16px;display:inline-block;background:${C.subtle};border:1px solid ${C.border};border-radius:8px;font:600 28px/36px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:6px;color:${C.text}">{{ .Token }}</p>`;
}

function placeholderButton(label: string): string {
  // Read at call time: this module and index.ts import each other.
  const C = EMAIL_COLOURS.light;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td class="cq-button" align="center" bgcolor="${C.accent}" style="background:${C.accent};border:1px solid ${C.accent};border-radius:8px"><a href="${URL_PLACEHOLDER}" target="_blank" style="display:inline-block;padding:13px 24px;font:600 16px/20px ${FONT};color:${C.onAccent};text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table><p class="cq-secondary" style="margin:0 0 16px;font:14px/22px ${FONT};color:${C.secondary}">Or paste this link into your browser: <a class="cq-link" href="${URL_PLACEHOLDER}" style="color:${C.accent};text-decoration:underline;word-break:break-all">${URL_PLACEHOLDER}</a></p>`;
}

export type AuthTemplate = {
  /** File name under supabase/templates and the config section. */
  readonly name:
    "confirmation" | "magic_link" | "recovery" | "email_change" | "invite";
  readonly subject: string;
  readonly html: string;
};

const TEMPLATES: readonly {
  readonly name: AuthTemplate["name"];
  readonly subject: string;
  readonly heading: string;
  readonly lead: string;
  readonly button: string;
  readonly reason: string;
  /** Show the 6-digit code too (typed in the step-up sign-in). */
  readonly code?: boolean;
}[] = [
  {
    name: "confirmation",
    subject: "Confirm your email for Capital Q",
    heading: "Confirm your email",
    lead: "Confirm this address to finish creating your Capital Q account.",
    button: "Confirm email",
    reason:
      "You're receiving this because this address was used to sign up for Capital Q. If that wasn't you, ignore this email.",
  },
  {
    name: "magic_link",
    subject: "Your Capital Q sign-in link",
    heading: "Sign in to Capital Q",
    lead: "Use this link, or enter the code, to sign in. Both work once and expire soon.",
    button: "Sign in",
    code: true,
    reason:
      "You're receiving this because someone asked to sign in with this address. If that wasn't you, ignore this email.",
  },
  {
    name: "recovery",
    subject: "Reset your Capital Q password",
    heading: "Reset your password",
    lead: "Choose a new password for your Capital Q account. The link expires soon.",
    button: "Choose a new password",
    reason:
      "You're receiving this because a password reset was requested for this address. If that wasn't you, ignore this email; your password stays the same.",
  },
  {
    name: "email_change",
    subject: "Confirm your new email for Capital Q",
    heading: "Confirm your new email",
    lead: "Confirm this address to use it for your Capital Q account.",
    button: "Confirm new email",
    reason:
      "You're receiving this because a change of email was requested for a Capital Q account. If that wasn't you, ignore this email.",
  },
  {
    name: "invite",
    subject: "You're invited to Capital Q",
    heading: "You're invited to Capital Q",
    lead: "Accept the invitation to set up your account.",
    button: "Accept invitation",
    reason:
      "You're receiving this because someone invited this address to Capital Q.",
  },
];

export function authEmailTemplates(): readonly AuthTemplate[] {
  return TEMPLATES.map((template) => ({
    name: template.name,
    subject: template.subject,
    html: renderEmail({
      subject: template.subject,
      preheader: template.lead,
      heading: template.heading,
      blocks: [
        { kind: "paragraph", text: template.lead },
        {
          kind: "trusted",
          html: {
            trustedHtml: `${placeholderButton(template.button)}${template.code === true ? codeBlock() : ""}`,
          },
          text: `${template.button}: ${URL_PLACEHOLDER}${template.code === true ? "\nOr enter this code: {{ .Token }}" : ""}`,
        },
      ],
      reason: template.reason,
      origin: null,
    }).html,
  }));
}
