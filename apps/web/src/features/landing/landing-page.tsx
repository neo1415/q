import localFont from "next/font/local";
import type { CSSProperties, ReactNode } from "react";

import { PWA_STANDALONE_SCRIPT } from "@/auth/landing-route";

import { CallScene } from "./call-scene";
import { ConvergeScene } from "./converge-scene";
import { DemoScene } from "./demo-scene";
import { DEMO_POLICY } from "./gateq-demo";
import { GateQIsland } from "./gateq-island";
import { GATE_START, GateQView, type GateRow } from "./gateq-view";
import { HeroStage } from "./hero-stage";
import {
  CONVERGE,
  FAQ,
  GATEQ_ANCHOR,
  HERO,
  HOW_ANCHOR,
  INTRODUCTIONS,
  PITCHES,
  SIGN_IN_HREF,
  SIGN_UP_HREF,
} from "./landing-content";
import { PlanScene } from "./plan-scene";

import "./landing.css";

/**
 * Hanken Grotesk, self-hosted (SIL Open Font License), latin subset, one
 * variable file for 400 to 600. next/font preloads it and sizes a
 * metric-matched fallback, so the swap never moves a line.
 */
const hanken = localFont({
  src: "./fonts/hanken-grotesk-latin.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  variable: "--cq-font-landing",
  fallback: ["Arial"],
  adjustFontFallback: "Arial",
});

/**
 * The landing page, for signed-out visitors in a browser (founder-approved
 * design, 2026-10-04). Server-rendered and prerendered; only the animated
 * parts are client islands, each starting when its section nears the
 * screen. Every illustration uses fictional names and says so.
 */
export function LandingPage() {
  return (
    <div className={`lp cq-landing ${hanken.variable}`}>
      {/* An installed launch never sees this page (src/auth/landing-route.ts). */}
      <script dangerouslySetInnerHTML={{ __html: PWA_STANDALONE_SCRIPT }} />
      <Sprite />
      <header className="nav" data-lp-nav="">
        <div className="wrap">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            Capital Q
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href={`#${GATEQ_ANCHOR}`}>Try GateQ</a>
            <a href={`#${HOW_ANCHOR}`}>How Q works</a>
            <a href={SIGN_IN_HREF}>Sign in</a>
            <a className="btn btn-primary" href={SIGN_UP_HREF}>
              Get started
            </a>
          </nav>
        </div>
      </header>

      <main>
        <Hero />
        <Converge />
        <HowQWorks />
        <Claims />
        <section className="sec sec-tight">
          <PlanScene
            heading={
              <h2 className="d2">
                Three steps.
                <br />Q does the reading.
              </h2>
            }
            feed={<Feed />}
          />
        </section>
        <TryGateQ />
        <Rehearsal />
        <Success />
        <Questions />
        <section className="dark on-stage final">
          <div className="wrap">
            <h2 className="d1">Bring the evidence. Q does the rest.</h2>
            <p className="lede final-lede">With your approval, every time.</p>
            <div className="ctas">
              <a className="btn btn-primary btn-light" href={SIGN_UP_HREF}>
                Get started
              </a>
              <a className="btn btn-quiet" href={`#${GATEQ_ANCHOR}`}>
                Try GateQ
              </a>
            </div>
          </div>
        </section>
      </main>
      <footer className="dark">
        <div className="wrap">
          <span>Capital Q. Investment intelligence for private capital.</span>
          <span>Illustrations use fictional names.</span>
        </div>
      </footer>
    </div>
  );
}

function Icon({ id }: { readonly id: string }) {
  return (
    <svg aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="wrap">
        <div className="hero-top">
          <h1 className="d1 load">
            Private capital,
            <br />
            on evidence.
          </h1>
          <div className="hero-side">
            <p className="lede load l2">{HERO.lede}</p>
            <div className="ctas load l3">
              <a className="btn btn-primary" href={SIGN_UP_HREF}>
                Get started
              </a>
              <a className="btn btn-quiet" href={`#${GATEQ_ANCHOR}`}>
                Try GateQ
              </a>
            </div>
          </div>
        </div>

        <div className="window" aria-label="Illustration of the Q page">
          <aside className="sidebar" aria-hidden="true">
            <span className="brand">
              <span className="brand-mark" />
              Capital Q
            </span>
            <span className="side-item on">
              <Icon id="i-ask" />Q
            </span>
            <span className="side-item">
              <Icon id="i-grid" />
              Discover
            </span>
            <span className="side-item">
              <Icon id="i-file" />
              Work
            </span>
            <span className="side-item">
              <Icon id="i-link" />
              Relationships
            </span>
            <span className="side-item">
              <Icon id="i-mail" />
              Company
            </span>
            <div className="side-foot">
              <span>Light</span>
              <span className="on">Device</span>
              <span>Dark</span>
            </div>
          </aside>
          <HeroStage>
            <p className="stage-said">
              Three introductions are ready for your approval.
            </p>
            <div className="stage-bar" aria-hidden="true">
              <span>Ask Q, or say what you want done</span>
              <span className="mic">
                <Icon id="i-mic" />
              </span>
            </div>
          </HeroStage>
          <div className="board" aria-hidden="true">
            <h4>
              Needs you <span>3</span>
            </h4>
            <MiniCard
              title="Introduction to Harbour Lane Ventures"
              body="Fennel Pay, seed round. Matches their payments focus."
              chip="Needs your approval"
              warn
              action="Review"
            />
            <MiniCard
              title="Introduction to Meridian Seed"
              body="Stage and sector fit their published mandate."
              chip="Needs your approval"
              warn
              action="Review"
            />
            <MiniCard
              title="Confirm Q's reading of your deck"
              body="Four figures found. Nothing is used until you confirm."
              chip="Q inference"
              action="Confirm"
            />
            <div className="now">
              <h4>Now</h4>
              <div className="now-item">
                <i />
                Reading the Q3 board pack you uploaded
              </div>
            </div>
          </div>
        </div>
        <p className="small caption">
          The Q page. An illustration; names are fictional.
        </p>
      </div>
    </section>
  );
}

function MiniCard(props: {
  readonly title: string;
  readonly body: string;
  readonly chip: string;
  readonly warn?: boolean;
  readonly action: string;
}) {
  return (
    <div className="mini-card">
      <b>{props.title}</b>
      <p>{props.body}</p>
      <div className="row">
        <span className={props.warn ? "chip warn" : "chip"}>{props.chip}</span>
        <span className="mini-btn">{props.action}</span>
      </div>
    </div>
  );
}

/** Where each scattered version sits before it converges (px, deg). */
const FRAGMENTS = [
  { x: -210, y: -190, r: -6 },
  { x: 190, y: -150, r: 5 },
  { x: -160, y: 40, r: 4 },
  { x: 230, y: 70, r: -4 },
  { x: -40, y: 210, r: -3 },
] as const;

function Frag({
  i,
  icon,
  source,
  children,
}: {
  readonly i: number;
  readonly icon: string;
  readonly source: string;
  readonly children: ReactNode;
}) {
  const f = FRAGMENTS[i] ?? FRAGMENTS[0];
  // The scene's first frame, so nothing jumps when its script arrives.
  const drift = Math.sin(i) * 6;
  return (
    <div
      className="frag"
      data-x={f.x}
      data-y={f.y}
      data-r={f.r}
      style={{
        transform: `translate(-50%,-50%) translate(${f.x}px,${f.y + drift}px) rotate(${f.r}deg) scale(1)`,
      }}
    >
      <div className="src">
        <Icon id={icon} />
        {source}
      </div>
      {children}
    </div>
  );
}

function Converge() {
  return (
    <ConvergeScene>
      <div className="converge-pin">
        <div className="wrap">
          <div>
            <div className="swap">
              <h2 className="d2" data-conv="a">
                {CONVERGE.before.title}
              </h2>
              <h2 className="d2 off" data-conv="b" aria-hidden="true">
                {CONVERGE.after.title}
              </h2>
            </div>
            <p className="lede" data-conv="lede">
              {CONVERGE.before.lede}
            </p>
          </div>
          <div className="field" aria-hidden="true">
            <Frag i={0} icon="i-mail" source="Inbox">
              <b>Re: Re: Fwd: intro?</b>
              <br />
              <span className="muted">Deck_final_v7.pdf attached</span>
            </Frag>
            <Frag i={1} icon="i-grid" source="Fund CRM">
              Fennel Pay: stage <b className="stage-word">Diligence</b>
            </Frag>
            <Frag i={2} icon="i-grid" source="Founder's tracker">
              Harbour Lane: stage <b className="stage-word">First call</b>
            </Frag>
            <Frag i={3} icon="i-file" source="Deck, slide 9">
              <b>Revenue</b> &quot;growing fast&quot;
              <br />
              <span className="muted">No source</span>
            </Frag>
            <Frag i={4} icon="i-mail" source="Message">
              Did anyone actually read it?
            </Frag>
            <div className="record">
              <div className="parties">
                Fennel Pay <Icon id="i-link" /> Harbour Lane Ventures
              </div>
              <div className="stage-now">
                <strong>In conversation</strong>
                <span className="small">computed from what happened</span>
              </div>
              <ul className="events">
                {[
                  "First call held",
                  "Introduction sent after approval",
                  "Matched on stage and sector",
                ].map((e) => (
                  <li key={e}>
                    <i />
                    <span>{e}</span>
                    <span className="who">Shared with both sides</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </ConvergeScene>
  );
}

function HowQWorks() {
  return (
    <section className="dark sec on-stage" id={HOW_ANCHOR}>
      <div className="wrap">
        <div className="sec-head">
          <h2 className="d2">
            Say it once.
            <br />
            Approve what Q prepares.
          </h2>
          <p className="lede">
            Q shows exactly what will be sent, and to whom. Nothing leaves until
            you approve that exact message.
          </p>
        </div>
        <DemoScene>
          <svg className="cursor" viewBox="0 0 22 22" aria-hidden="true">
            <path
              d="M4 2l13 8.5-6 1.2-3.2 5.6z"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <div className="msg-me" data-hide="" data-d1="ask">
            Handle my seed introductions. Leave out Clinicrest.
          </div>
          <div className="msg-q" data-hide="" data-d1="q">
            <b>Q</b>
            <span>
              Three introductions prepared. Clinicrest is left out, as you
              asked.
            </span>
          </div>
          <div className="cards">
            {INTRODUCTIONS.map((p, i) => (
              <div className="acard" data-hide="" data-card={i} key={p.to}>
                <div className="acard-top">
                  <span>
                    <b>{p.to}</b> <span className="org">{p.org}</span>
                  </span>
                  <span className="status">Needs your approval</span>
                </div>
                <div className="acard-body">
                  <div>
                    <span className="subj">{p.subject}</span>
                    <p>{p.body}</p>
                    <span className="fine">
                      You approve this exact message. If it changes, it comes
                      back to you.
                    </span>
                    <button className="approve" type="button" tabIndex={-1}>
                      Approve and send
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="done-line" data-hide="" data-d1="done">
            <svg width="16" height="16" aria-hidden="true">
              <use href="#i-check" />
            </svg>
            All three sent, each recorded once on its relationship&apos;s
            history.
          </div>
        </DemoScene>
        <p className="small caption">
          An illustration with fictional names, not a live session.
        </p>
      </div>
    </section>
  );
}

function Fact({
  k,
  chip,
  how,
}: {
  readonly k: string;
  readonly chip: ReactNode;
  readonly how?: string;
}) {
  return (
    <div className="fact">
      <div className="k">
        <span>{k}</span>
        {chip}
      </div>
      {how === undefined ? null : <span className="how">{how}</span>}
    </div>
  );
}

function Lock() {
  return (
    <span className="lock">
      <Icon id="i-lock" />
      Not shared with you
    </span>
  );
}

const RANKED = [
  ["Fennel Pay", "Stage and sector fit, document-supported revenue"],
  ["Kestrel Grid", "Sector fit, updated this week"],
  ["Tallow Health", "Stage fit, revenue unknown"],
] as const;

const TIMELINE = [
  ["2 Oct", "First call held", "Shared with both sides", false],
  [
    "1 Oct",
    "Partner note: strong team, check concentration",
    "Only your side can see this",
    true,
  ],
  [
    "28 Sep",
    "Introduction sent after approval",
    "Shared with both sides",
    false,
  ],
  ["27 Sep", "Qualified through GateQ", "Shared with both sides", false],
] as const;

function Claims() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="d2">Built so you can trust what you see.</h2>
          <p className="lede">
            Q has intelligence authority. You keep commercial authority. Capital
            Q keeps the rules.
          </p>
        </div>
        <div className="bento">
          <article className="tile t4">
            <h3>Ranking can&apos;t be bought.</h3>
            <p>
              Investors see companies in an order set by mandate, fit, evidence
              and freshness.
            </p>
            <div className="vis">
              <div className="rank-list">
                {RANKED.map(([name, why], i) => (
                  <div className="rank" key={name}>
                    <span className="n">{i + 1}</span>
                    <span>{name}</span>
                    <span className="why">{why}</span>
                  </div>
                ))}
              </div>
              <div className="inputs">
                <div>
                  <span className="h">Counts</span>
                  <span>Declared mandate</span>
                  <span>Fit</span>
                  <span>Evidence and freshness</span>
                </div>
                <div>
                  <span className="h">Never counts</span>
                  <s>Payment</s>
                  <s>Views and watch time</s>
                  <s>Who you know</s>
                </div>
              </div>
            </div>
          </article>
          <article className="tile t2">
            <h3>Evidence before opinion.</h3>
            <p>
              Every fact shows who said it and how well it&apos;s supported.
            </p>
            <div className="vis facts">
              <Fact
                k="Monthly revenue"
                chip={<span className="chip pos">Document-supported</span>}
                how="Management accounts, Q3"
              />
              <Fact
                k="Customers"
                chip={<span className="chip">Self-reported</span>}
                how="Founder, onboarding"
              />
              <Fact
                k="Churn"
                chip={<span className="chip">Unknown</span>}
                how="Not a black mark. Just not known yet."
              />
              <Fact
                k="Headcount"
                chip={<span className="chip warn">Two figures disagree</span>}
                how="Both shown. Neither picked."
              />
            </div>
          </article>
          <article className="tile t2 ink">
            <h3>A firewall on founder-private data.</h3>
            <p>
              What a founder keeps private never shapes what an investor is
              shown.
            </p>
            <div className="vis facts">
              <Fact k="Cash in bank" chip={<Lock />} />
              <Fact k="Monthly burn" chip={<Lock />} />
              <Fact
                k="Payroll"
                chip={<Lock />}
                how="Filtered before Q or the ranking sees it."
              />
            </div>
          </article>
          <article className="tile t4">
            <h3>One shared record.</h3>
            <p>
              One relationship per company and investor. Its stage comes from
              what happened, never from a model.
            </p>
            <div className="vis tl">
              <ul>
                {TIMELINE.map(([d, what, to, own]) => (
                  <li className={own ? "own" : undefined} key={d}>
                    <span className="d">{d}</span>
                    <i />
                    <span>{what}</span>
                    <span className="vis-to">{to}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

const RAIL = [
  ["save", "i-bookmark", "Save"],
  ["pass", "i-pass", "Pass"],
  ["interest", "i-hand", "Interest"],
  ["share", "i-share", "Share"],
  ["ask", "i-ask", "Ask Q"],
] as const;

function Feed() {
  return (
    <>
      {PITCHES.map((p, i) => (
        <div
          className={i === 0 ? "pitch cur" : "pitch"}
          data-pitch={i}
          key={p.name}
          style={
            {
              "--cq-landing-hue-a": p.hue[0],
              "--cq-landing-hue-b": p.hue[1],
            } as CSSProperties
          }
        >
          <div className="frame">
            <div className="ken">
              <div className="person">
                <span className="body" />
                <span className="hair" />
                <span className="head" />
              </div>
            </div>
          </div>
          <div className="vprog">
            <i />
          </div>
          <div className="scrim" />
          <div className="pmeta">
            <b>{p.name}</b>
            <span className="tags">{p.tags}</span>
            <span className="why">
              <span className="qd" />
              {p.why}
            </span>
          </div>
          <div className="rail">
            {RAIL.map(([a, icon, word]) => (
              <div data-a={a} key={a}>
                <span className="ic">
                  <Icon id={icon} />
                </span>
                <span data-word="">{word}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TryGateQ() {
  const rows: GateRow[] = DEMO_POLICY.criteria.map((c) => ({
    key: c.id,
    label: c.label,
    requiredness: c.requiredness === "REQUIRED" ? "Required" : "Preferred",
    status: null,
  }));
  return (
    <section className="sec gateq-sec" id={GATEQ_ANCHOR}>
      <div className="wrap">
        <div className="sec-head">
          <h2 className="d2">Try GateQ: am I a fit?</h2>
          <p className="lede">
            Check yourself against a fictional investor. Skip anything you like;
            unknown is not a no.
          </p>
        </div>
        <GateQIsland
          fallback={
            <GateQView
              answers={{}}
              rows={rows}
              verdict={GATE_START.verdict}
              sub={GATE_START.sub}
            />
          }
        />
      </div>
    </section>
  );
}

const REVIEW = [
  ["Opening", "Clear"],
  ["Market", "Clear"],
  ["Concentration", "Needs evidence"],
  ["Next ask", "Missing"],
] as const;

function Rehearsal() {
  return (
    <section className="dark sec on-stage">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="d2">
            Rehearse the call
            <br />
            before it counts.
          </h2>
          <p className="lede">
            Pitch out loud to Q. It listens, pushes back, and reviews you
            afterwards.
          </p>
        </div>
        <CallScene
          side={
            <div className="call-side">
              <div className="self">
                <span className="ini">AO</span>
                <span className="lvl" data-lvl="">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="nm">You</span>
              </div>
              <div className="review">
                <b>Your review, after the call</b>
                {REVIEW.map(([k, v]) => (
                  <div className="r" key={k}>
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              <div className="controls" aria-hidden="true">
                <span>
                  <Icon id="i-mic" />
                </span>
                <span className="end">End rehearsal</span>
              </div>
            </div>
          }
        />
        <p className="small caption">
          An illustration of the rehearsal room. The script is fictional.
        </p>
      </div>
    </section>
  );
}

const RELATIONSHIPS = [
  [
    "Harbour Lane Ventures",
    "In conversation",
    "chip acc",
    "First call held. Q prepared a follow-up.",
    "Needs you",
    "chip warn",
  ],
  [
    "Meridian Seed",
    "Introduced",
    "chip",
    "Introduction sent after your approval.",
    "Waiting",
    "chip",
  ],
  [
    "Demo Ridge Capital",
    "Qualified",
    "chip",
    "GateQ: nothing rules you out. Two answers open.",
    "Your move",
    "chip",
  ],
  [
    "Kestrel Climate Fund",
    "Passed",
    "chip",
    "Their reason stays private to them.",
    "Closed",
    "chip",
  ],
] as const;

function Success() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="d2">Where it leads.</h2>
          <p className="lede">
            Not months of outreach to investors who were never a fit. Not a
            message you never saw.
          </p>
        </div>
        <div
          className="work"
          aria-label="Illustration of the Relationships page"
        >
          <div className="work-head">
            <b>Relationships</b>
            <span className="small">Each stage computed from its history</span>
          </div>
          {RELATIONSHIPS.map(
            ([org, stage, stageClass, last, next, nextClass]) => (
              <div className="wrow" key={org}>
                <span className="org">{org}</span>
                <span>
                  <span className={stageClass}>{stage}</span>
                </span>
                <span className="last">{last}</span>
                <span className={nextClass}>{next}</span>
              </div>
            ),
          )}
        </div>
        <div className="two">
          <div>
            <h3 className="d3">If you&apos;re raising</h3>
            <p>
              A short list of investors who fit, each conversation on one shared
              record, every message sent only after you approved it.
            </p>
          </div>
          <div>
            <h3 className="d3">If you&apos;re investing</h3>
            <p>
              A pipeline that fits your mandate with the reasons visible, and a
              history both sides read from the same row.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Questions() {
  return (
    <section className="sec sec-tight">
      <div className="wrap faq">
        <h2 className="d2">Questions.</h2>
        <div>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span className="pm" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sprite() {
  const line = {
    fill: "none",
    stroke: "currentColor",
  } as const;
  return (
    <svg width="0" height="0" className="lp-sprite" aria-hidden="true">
      <defs>
        <symbol id="i-check" viewBox="0 0 16 16">
          <path
            d="M3.5 8.5l3 3 6-7"
            {...line}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="i-q" viewBox="0 0 16 16">
          <path
            d="M6 6a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9V9.5M8 12h.01"
            {...line}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="i-x" viewBox="0 0 16 16">
          <path
            d="M4.5 4.5l7 7M11.5 4.5l-7 7"
            {...line}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="i-lock" viewBox="0 0 16 16">
          <rect
            x="3"
            y="7"
            width="10"
            height="7"
            rx="1.5"
            {...line}
            strokeWidth="1.5"
          />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" {...line} strokeWidth="1.5" />
        </symbol>
        <symbol id="i-mail" viewBox="0 0 16 16">
          <rect
            x="2"
            y="3.5"
            width="12"
            height="9"
            rx="1.5"
            {...line}
            strokeWidth="1.4"
          />
          <path d="M2.5 4.5L8 9l5.5-4.5" {...line} strokeWidth="1.4" />
        </symbol>
        <symbol id="i-file" viewBox="0 0 16 16">
          <path
            d="M4 2h5l3 3v9H4z M9 2v3h3"
            {...line}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="i-grid" viewBox="0 0 16 16">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="1.5"
            {...line}
            strokeWidth="1.4"
          />
          <path d="M2 6.5h12M2 10.5h12M6.5 2v12" {...line} strokeWidth="1.4" />
        </symbol>
        <symbol id="i-link" viewBox="0 0 16 16">
          <path d="M2 8h12" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="2.5" cy="8" r="1.8" fill="currentColor" />
          <circle cx="13.5" cy="8" r="1.8" fill="currentColor" />
        </symbol>
        <symbol id="i-bookmark" viewBox="0 0 20 20">
          <path
            d="M5.5 3h9v14l-4.5-3.2L5.5 17z"
            {...line}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="i-pass" viewBox="0 0 20 20">
          <path
            d="M6 10h8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="i-hand" viewBox="0 0 20 20">
          <path
            d="M4 10.5l4 4 8-9"
            {...line}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="i-share" viewBox="0 0 20 20">
          <path
            d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4"
            {...line}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="i-ask" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6.5" {...line} strokeWidth="1.6" />
          <path
            d="M13.5 13.5L17 17"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="i-mic" viewBox="0 0 16 16">
          <rect
            x="5.5"
            y="1.5"
            width="5"
            height="8"
            rx="2.5"
            {...line}
            strokeWidth="1.4"
          />
          <path
            d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15"
            {...line}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </symbol>
      </defs>
    </svg>
  );
}
