import type { ReactNode } from "react";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

import "./site-content.css";

/**
 * The frame of the public site pages (decision 107): pricing, FAQ and the
 * legal pages. Reads no request data, so the pages stay cacheable; the
 * brand is Capital Q's own default, as on the landing page.
 */

export const SITE_LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/cookies", label: "Cookie Policy" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/legal/ai-disclaimer", label: "AI and Investment Disclaimer" },
  { href: "/legal/meeting-recording", label: "Meeting Recording" },
  { href: "/legal/dpa", label: "Data Processing Addendum" },
] as const;

export const SITE_PRODUCT_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
] as const;

/** The footer's short disclaimer, kept identical to the landing footer's default. */
export const SITE_DISCLAIMER =
  "Capital Q is not an investment adviser, broker or crowdfunding portal and never holds investment money. Q is an AI and can make mistakes. Nothing on this site is investment, legal, tax or financial advice.";

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block size-[22px] overflow-hidden rounded-full bg-(--cq-stage-canvas) after:absolute after:inset-[6px] after:rounded-full after:border-[1.5px] after:border-(--cq-stage-q-light)"
    />
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-(--cq-z-sticky) border-b border-(--cq-border-subtle) bg-(--cq-canvas)">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-8">
        <a
          href="/"
          className="cq-body flex min-h-11 items-center gap-2.5 font-semibold tracking-[-0.02em] text-(--cq-text-primary)"
        >
          <BrandMark />
          Capital Q
        </a>
        <nav aria-label="Site" className="ms-auto flex items-center gap-1">
          {SITE_PRODUCT_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              // D5: Pricing stays in the bar on a phone; FAQ waits for room.
              className={`cq-body-sm min-h-11 items-center rounded-(--cq-radius-md) px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:inline-flex sm:px-3 ${
                link.href === "/pricing" ? "inline-flex" : "hidden"
              }`}
            >
              {link.label}
            </a>
          ))}
          <ThemeToggle
            display="icons"
            size="touch"
            className="hidden md:flex"
          />
          <a
            href="/auth/sign-in"
            className="cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-2 sm:px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          >
            Sign in
          </a>
          <a
            href="/auth/sign-up"
            className="cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-md) bg-(--cq-accent) px-4 font-medium text-(--cq-text-inverse) transition-[background-color,transform] duration-(--cq-motion-fast) hover:bg-(--cq-accent-hover) active:scale-[0.98]"
          >
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-(--cq-border-subtle) bg-(--cq-surface-subtle)">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-[1.2fr_1fr_1.6fr]">
          <div className="flex flex-col gap-2">
            <p className="cq-body flex items-center gap-2.5 font-semibold text-(--cq-text-primary)">
              <BrandMark />
              Capital Q
            </p>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Investment intelligence for private capital.
            </p>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-1">
            {SITE_PRODUCT_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:min-h-8"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <nav
            aria-label="Legal"
            className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2"
          >
            {SITE_LEGAL_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:min-h-8"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <p className="cq-caption max-w-3xl text-(--cq-text-tertiary)">
          {SITE_DISCLAIMER}
        </p>
      </div>
    </footer>
  );
}

export function SitePageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-(--cq-canvas) text-(--cq-text-primary)">
      <PublicBrandStyle />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** What a public page shows while its words wait for review or the API is away. */
export function SiteNotYetPublished({ title }: { readonly title: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-24 sm:px-8">
      <h1 className="cq-title-xl text-(--cq-text-primary)">{title}</h1>
      <p className="cq-body text-(--cq-text-secondary)">
        This page is being prepared and isn&apos;t published yet. For anything
        you need now, write to us from inside the app, or come back soon.
      </p>
      <p>
        <a
          href="/"
          className="cq-body-sm underline underline-offset-[3px] text-(--cq-text-primary)"
        >
          Back to the home page
        </a>
      </p>
    </div>
  );
}
