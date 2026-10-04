import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName, cx } from "@capital-q/ui";

import { PWA_STANDALONE_SCRIPT } from "@/auth/landing-route";
import { ThemeToggle } from "@/features/appearance/theme-toggle";

import {
  FAILURE,
  FAQ,
  FINAL,
  FOOTER,
  GATEQ,
  GATEQ_ANCHOR,
  GUIDE,
  HERO,
  PLAN,
  PROBLEM,
  REHEARSAL,
  SIGN_IN_HREF,
  SIGN_UP_HREF,
  SUCCESS,
  WATCH,
  WATCH_ANCHOR,
} from "./landing-copy";
import {
  GateQDemoIsland,
  HeroPresenceIsland,
  WatchQWorkIsland,
} from "./landing-islands";

/**
 * The Capital Q landing page, in StoryBrand order
 * (docs/handoff/demo/landing-storybrand.md). A server component with no
 * request data, so the route prerenders. Only three islands hydrate: Q's
 * presence, "Watch Q work" and the GateQ demo, each loaded near the
 * viewport.
 *
 * Restraint is the design: one column of type, hairline rules instead of
 * cards, colour only where it carries meaning, and light only on Q.
 */

function Container({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full max-w-(--cq-layout-wide) px-(--cq-page-gutter)",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Section({
  id,
  label,
  className,
  children,
}: {
  readonly id?: string;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      data-landing-section={label}
      className={cx("cq-landing-section", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}

function SectionTitle({ children }: { readonly children: ReactNode }) {
  return <h2 className="cq-landing-h2 text-(--cq-text-primary)">{children}</h2>;
}

function Header() {
  return (
    <header className="cq-landing-header">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="cq-title-md rounded-xs text-(--cq-text-primary)"
          aria-label="Capital Q home"
        >
          Capital Q
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <a
            href={`#${GATEQ_ANCHOR}`}
            className={cx(
              buttonClassName("quiet", "compact"),
              "hidden sm:inline-flex",
            )}
          >
            {HERO.secondary}
          </a>
          <Link
            href={SIGN_IN_HREF}
            className={buttonClassName("quiet", "compact")}
          >
            Sign in
          </Link>
          <Link
            href={SIGN_UP_HREF}
            className={buttonClassName("primary", "compact")}
          >
            {HERO.primary}
          </Link>
        </nav>
      </Container>
    </header>
  );
}

function Hero() {
  return (
    <section
      aria-label="Introduction"
      data-landing-section="Hero"
      className="cq-landing-hero"
    >
      <Container className="cq-landing-hero-grid">
        <div className="cq-landing-hero-copy">
          <h1 className="cq-landing-h1 text-(--cq-text-primary)">
            {HERO.title}
          </h1>
          <p className="cq-landing-lede mt-5 text-(--cq-text-secondary)">
            {HERO.oneLiner}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={SIGN_UP_HREF}
              className={buttonClassName("primary", "large")}
              data-cta="direct"
            >
              {HERO.primary}
            </Link>
            <a
              href={`#${GATEQ_ANCHOR}`}
              className={buttonClassName("secondary", "large")}
              data-cta="transitional"
            >
              {HERO.secondary}
            </a>
            <a
              href={`#${WATCH_ANCHOR}`}
              className={cx(
                buttonClassName("quiet", "large"),
                "underline-offset-4 hover:underline",
              )}
              data-cta="transitional"
            >
              {HERO.tertiary}
            </a>
          </div>
          <p className="cq-caption mt-3 text-(--cq-text-tertiary)">
            {HERO.primaryNote}
          </p>
        </div>
        <HeroPresenceIsland />
      </Container>
    </section>
  );
}

function Problem() {
  return (
    <Section label="Problem">
      <SectionTitle>{PROBLEM.title}</SectionTitle>
      <div className="cq-landing-two mt-10">
        {PROBLEM.sides.map((side) => (
          <div key={side.who} className="cq-landing-rule">
            <h3 className="cq-title-sm text-(--cq-text-primary)">{side.who}</h3>
            <p className="cq-body mt-3 text-(--cq-text-primary)">
              {side.external}
            </p>
            <p className="cq-body mt-2 text-(--cq-text-secondary)">
              {side.internal}
            </p>
          </div>
        ))}
      </div>
      <p className="cq-landing-pull mt-12 text-(--cq-text-primary)">
        {PROBLEM.philosophical}
      </p>
    </Section>
  );
}

function Guide() {
  return (
    <Section label="Guide" className="cq-landing-band">
      <div className="cq-landing-split">
        <div>
          <SectionTitle>{GUIDE.title}</SectionTitle>
          <p className="cq-body-lg mt-4 text-(--cq-text-secondary)">
            {GUIDE.empathy}
          </p>
        </div>
        <ol className="flex flex-col">
          {GUIDE.claims.map((claim, index) => (
            <li key={claim.title} className="cq-landing-claim">
              <span className="cq-landing-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  {claim.title}
                </h3>
                <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
                  {claim.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

function Plan() {
  return (
    <Section label="Plan">
      <SectionTitle>{PLAN.title}</SectionTitle>
      <ol className="cq-landing-three mt-10">
        {PLAN.steps.map((step, index) => (
          <li key={step.title} className="cq-landing-rule">
            <p className="cq-landing-index" aria-hidden="true">
              {index + 1}
            </p>
            <h3 className="cq-title-sm mt-2 text-(--cq-text-primary)">
              {step.title}
            </h3>
            <dl className="mt-3 flex flex-col gap-2">
              <div>
                <dt className="cq-label text-(--cq-text-primary)">Founders</dt>
                <dd className="cq-body-sm text-(--cq-text-secondary)">
                  {step.founder}
                </dd>
              </div>
              <div>
                <dt className="cq-label text-(--cq-text-primary)">Investors</dt>
                <dd className="cq-body-sm text-(--cq-text-secondary)">
                  {step.investor}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <Link
          href={SIGN_UP_HREF}
          className={buttonClassName("primary", "large")}
        >
          {HERO.primary}
        </Link>
      </div>
    </Section>
  );
}

function Watch() {
  return (
    <Section id={WATCH_ANCHOR} label="Watch Q work" className="cq-landing-band">
      <div className="cq-landing-split">
        <div>
          <SectionTitle>{WATCH.title}</SectionTitle>
          <p className="cq-body-lg mt-4 text-(--cq-text-secondary)">
            {WATCH.intro}
          </p>
          <p className="cq-body-sm mt-4 text-(--cq-text-secondary)">
            {GUIDE.claims[2].body}
          </p>
        </div>
        <WatchQWorkIsland
          fallback={
            <p className="cq-caption text-(--cq-text-secondary)">
              {WATCH.label}
            </p>
          }
        />
      </div>
    </Section>
  );
}

function TryGateQ() {
  return (
    <Section id={GATEQ_ANCHOR} label="Try GateQ">
      <div className="max-w-(--cq-layout-reading)">
        <SectionTitle>{GATEQ.title}</SectionTitle>
        <p className="cq-body-lg mt-4 text-(--cq-text-secondary)">
          {GATEQ.intro}
        </p>
      </div>
      <GateQDemoIsland
        fallback={
          <p className="cq-caption text-(--cq-text-secondary)">
            {GATEQ.privacy}
          </p>
        }
      />
    </Section>
  );
}

function Success() {
  return (
    <Section label="Success" className="cq-landing-band">
      <SectionTitle>{SUCCESS.title}</SectionTitle>
      <div className="cq-landing-two mt-10">
        {SUCCESS.stories.map((story) => (
          <div key={story.who} className="cq-landing-rule">
            <h3 className="cq-title-sm text-(--cq-text-primary)">
              {story.who}
            </h3>
            <p className="cq-body mt-3 text-(--cq-text-secondary)">
              {story.body}
            </p>
          </div>
        ))}
      </div>
      <p className="cq-caption mt-6 text-(--cq-text-tertiary)">
        {SUCCESS.label}
      </p>
    </Section>
  );
}

function Failure() {
  return (
    <Section label="Failure avoided">
      <div className="cq-landing-split">
        <SectionTitle>{FAILURE.title}</SectionTitle>
        <ul className="flex flex-col">
          {FAILURE.items.map((item) => (
            <li
              key={item}
              className="cq-body border-b border-(--cq-border-subtle) py-3 text-(--cq-text-primary)"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Rehearsal() {
  return (
    <Section label="Rehearsal" className="cq-landing-band">
      <div className="max-w-(--cq-layout-reading)">
        <SectionTitle>{REHEARSAL.title}</SectionTitle>
        <p className="cq-body-lg mt-4 text-(--cq-text-secondary)">
          {REHEARSAL.body}
        </p>
        <Link
          href={SIGN_UP_HREF}
          className={cx(buttonClassName("secondary", "large"), "mt-8")}
        >
          {REHEARSAL.cta}
        </Link>
      </div>
    </Section>
  );
}

function Questions() {
  return (
    <Section label="FAQ">
      <div className="cq-landing-split">
        <SectionTitle>{FAQ.title}</SectionTitle>
        <div className="flex flex-col">
          {FAQ.items.map((item) => (
            <details key={item.q} className="cq-landing-faq">
              <summary className="cq-body font-medium text-(--cq-text-primary)">
                {item.q}
              </summary>
              <p className="cq-body-sm pb-4 text-(--cq-text-secondary)">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <Section label="Get started" className="cq-landing-final">
      <h2 className="cq-landing-h2 max-w-(--cq-layout-reading) text-(--cq-text-primary)">
        {FINAL.title}
      </h2>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={SIGN_UP_HREF}
          className={buttonClassName("primary", "large")}
          data-cta="direct"
        >
          {FINAL.primary}
        </Link>
        <Link
          href={SIGN_IN_HREF}
          className={buttonClassName("secondary", "large")}
        >
          {FINAL.secondary}
        </Link>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-(--cq-border-subtle) py-10">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="cq-title-sm text-(--cq-text-primary)">Capital Q</p>
          <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
            {FOOTER.line}
          </p>
          <p className="cq-caption mt-3 text-(--cq-text-tertiary)">
            {FOOTER.copyright}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <nav aria-label="Footer" className="flex flex-wrap gap-1">
            <a
              href={`#${GATEQ_ANCHOR}`}
              className={buttonClassName("quiet", "compact")}
            >
              {HERO.secondary}
            </a>
            <Link
              href={SIGN_IN_HREF}
              className={buttonClassName("quiet", "compact")}
            >
              Sign in
            </Link>
            <Link
              href={SIGN_UP_HREF}
              className={buttonClassName("quiet", "compact")}
            >
              {HERO.primary}
            </Link>
          </nav>
          <ThemeToggle display="icons" size="touch" />
        </div>
      </Container>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="cq-landing">
      {/* An installed launch never sees this page (src/auth/landing-route.ts). */}
      <script dangerouslySetInnerHTML={{ __html: PWA_STANDALONE_SCRIPT }} />
      <a href="#main" className="cq-landing-skip">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Problem />
        <Guide />
        <Plan />
        <Watch />
        <TryGateQ />
        <Success />
        <Failure />
        <Rehearsal />
        <Questions />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
