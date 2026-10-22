"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import {
  AlertTriangle,
  Building2,
  Captions,
  Check,
  CircleAlert,
  Clock,
  FileText,
  Globe,
  Info,
  Mail,
  Pause,
  Play,
  Presentation,
  Search,
  Share2,
  Users,
  X,
} from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";
import { QCard } from "@/features/q-card/q-card";

import { PHOTOS, type PhotoKey } from "./photos";
import {
  FRAMES,
  buildTimeline,
  cueIndexAt,
  lineAt,
  type Frame,
  type LitTarget,
  type StoryState,
  type Timeline,
} from "./timeline";

import "./storyboard.css";

/**
 * The storyboard player (Q Story S2): the beat table on a fixed clock over
 * the real pages. `?t=<seconds>` opens paused at that moment (key frames),
 * `?play=1` plays from there, `?speed=` scales the clock. The recording run
 * drives it through `window.__qstory`.
 */

/** The clock is mutated in place by the frame loop (a ref, not state). */
type Clock = {
  t: number;
  playing: boolean;
  at: number;
  base: number;
  speed: number;
};

declare global {
  interface Window {
    __qstory?: {
      readonly total: number;
      seek: (t: number) => void;
      seekBeat: (label: string) => number;
      play: () => void;
      pause: () => void;
      now: () => number;
      beats: () => readonly { readonly t: number; readonly beat: string }[];
    };
  }
}

const media = (name: string) => `/dev/q-story/media/${name}`;

function Photo({
  k,
  label,
  className,
  style,
  on,
  needle,
}: {
  readonly k: PhotoKey;
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly on?: boolean;
  readonly needle?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure
      className={`qs-photo ${className ?? ""}`}
      style={style}
      data-on={on}
      data-needle={needle}
    >
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- a local review harness: the run answers these paths; no optimiser behind it
        <img
          src={media(`${k}.jpg`)}
          alt={PHOTOS[k].alt}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {label === undefined ? null : <figcaption>{label}</figcaption>}
    </figure>
  );
}

function In({
  on,
  off,
  children,
  className,
  as: Tag = "div",
  style,
  kind,
  latest,
}: {
  readonly kind?: string;
  readonly latest?: boolean;
  readonly on: boolean;
  readonly off?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "div" | "p" | "span";
  readonly style?: CSSProperties;
}) {
  return (
    <Tag
      className={`qs-in ${className ?? ""}`}
      data-on={on}
      data-off={off === true ? true : undefined}
      data-kind={kind}
      data-latest={latest === true ? true : undefined}
      style={style}
    >
      {children}
    </Tag>
  );
}

/* ——— Scenes (story layer). Each reads only its step. ——— */

const MONTAGE: readonly PhotoKey[] = [
  "m1",
  "m2",
  "m3",
  "m4",
  "m5",
  "m6",
  "m7",
  "m8",
  "m9",
  "m10",
  "m11",
  "m12",
];

function SceneView({ s }: { readonly s: StoryState }) {
  const step = s.step;
  switch (s.scene) {
    case "echo":
      // The investor's desk from Act 1, faint: the same night, both sides.
      return <Photo k="desk" className="qs-photo-bleed qs-echo" />;
    case "clock":
      return (
        <>
          <Photo k="desk" className="qs-photo-bleed" />
          <In on className="qs-big" as="p">
            11:47 PM
          </In>
        </>
      );
    case "inbox":
      return (
        <div className="qs-stack" style={{ width: "100%" }}>
          <div className="qs-inbox" aria-label="An inbox, illustrative">
            <In on={step >= 5} className="qs-row">
              <Building2 aria-hidden size={20} />
              <span>
                Application via your website
                <small>Applications</small>
              </span>
              <span className="qs-tag">11:46 PM</span>
            </In>
            <In on={step >= 4} className="qs-row">
              <Users aria-hidden size={20} />
              <span>
                Referral from a former colleague
                <small>Referrals</small>
              </span>
              <span className="qs-tag">11:31 PM</span>
            </In>
            <In on={step >= 3} className="qs-row">
              <Mail aria-hidden size={20} />
              <span>
                Intro: you two should meet
                <small>Introductions</small>
              </span>
              <span className="qs-tag">10:58 PM</span>
            </In>
            <In on={step >= 2} className="qs-row">
              <FileText aria-hidden size={20} />
              <span>
                Deck_SeriesA_v9_FINAL.pdf
                <small>Decks</small>
              </span>
              <span className="qs-tag">10:12 PM</span>
            </In>
            {[0, 1, 2].map((i) => (
              <In key={i} on={step >= 1} className="qs-ghost">
                {null}
              </In>
            ))}
          </div>
          <span className="qs-tag">Illustrative</span>
        </div>
      );
    case "montage":
      return (
        <>
          <div className="qs-grid" data-step={step}>
            {MONTAGE.map((k, i) => (
              <Photo
                key={k}
                k={k}
                style={{ "--i": i } as CSSProperties}
                needle={i === 6}
              />
            ))}
          </div>
          {step === 4 ? (
            <div className="qs-calendar" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <In key={i} on>
                  <span />
                </In>
              ))}
            </div>
          ) : null}
        </>
      );
    case "questions":
      return (
        <div className="qs-stack">
          <In on={step >= 1} off={step >= 2} className="qs-mid" as="p">
            Is this worth the risk?
          </In>
          <In on={step >= 2} className="qs-mid" as="p">
            Do I trust this business?
          </In>
        </div>
      );
    case "scale":
      return (
        <div className="qs-scale qs-stack" data-step={step}>
          <svg
            viewBox="0 0 600 280"
            role="img"
            aria-label="A scale: one weight known, one unknown"
          >
            <g className="qs-beam">
              <line
                x1="80"
                y1="70"
                x2="520"
                y2="70"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="120"
                y1="70"
                x2="120"
                y2="150"
                stroke="currentColor"
                strokeOpacity="0.4"
              />
              <line
                x1="480"
                y1="70"
                x2="480"
                y2="150"
                stroke="currentColor"
                strokeOpacity="0.4"
              />
              <g className="qs-in" data-on={step >= 1}>
                <rect
                  x="70"
                  y="150"
                  width="100"
                  height="70"
                  rx="10"
                  fill="currentColor"
                  fillOpacity="0.85"
                />
              </g>
              <g className="qs-in" data-on={step >= 2}>
                <rect
                  x="430"
                  y="150"
                  width="100"
                  height="70"
                  rx="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="7 6"
                />
                <text
                  x="480"
                  y="196"
                  textAnchor="middle"
                  fontSize="30"
                  fill="currentColor"
                >
                  ?
                </text>
              </g>
            </g>
            <line
              x1="300"
              y1="70"
              x2="300"
              y2="250"
              stroke="currentColor"
              strokeOpacity="0.5"
            />
            <line
              x1="250"
              y1="250"
              x2="350"
              y2="250"
              stroke="currentColor"
              strokeOpacity="0.5"
            />
          </svg>
          <div
            style={{
              display: "flex",
              gap: 48,
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <In on={step >= 1} className="qs-tag">
              Every bad investment
            </In>
            <In on={step >= 2} className="qs-tag">
              Every great one you never discover
            </In>
          </div>
          <In on={step >= 3} className="qs-tag">
            Unknown stays unknown
          </In>
        </div>
      );
    case "founder":
      return (
        <div
          className="qs-photorow qs-turn"
          style={{ "--n": 4 } as CSSProperties}
        >
          <Photo
            k="f1"
            label="You’ve spent years building."
            className="qs-in"
            on={step >= 1}
          />
          <Photo
            k="f2"
            label="Put your own money in."
            className="qs-in"
            on={step >= 2}
          />
          <Photo
            k="f3"
            label="Survived payroll."
            className="qs-in"
            on={step >= 3}
          />
          <Photo
            k="f4"
            label="Won customers."
            className="qs-in"
            on={step >= 4}
          />
        </div>
      );
    case "goraise":
      return (
        <In
          on
          className="qs-big"
          as="p"
          style={{ transform: "rotate(-1.5deg)" }}
        >
          “Go raise.”
        </In>
      );
    case "rounds":
      return <Rounds step={step} />;
    case "callback":
      return <Callback step={step} />;
    case "established":
      return (
        <div className="qs-photorow" style={{ "--n": 3 } as CSSProperties}>
          <Photo
            k="e1"
            label="an established business"
            className="qs-in"
            on={step >= 1}
          />
          <Photo
            k="e2"
            label="finance expansion"
            className="qs-in"
            on={step >= 2}
          />
          <Photo
            k="e3"
            label="enter a new market"
            className="qs-in"
            on={step >= 3}
          />
        </div>
      );
    case "twobeat":
      return (
        <div className="qs-stack">
          <In on={step >= 1} className="qs-mid" as="p">
            Different stage.
          </In>
          <In on={step >= 2} className="qs-big" as="p">
            Same problem.
          </In>
        </div>
      );
    case "verbs":
      return (
        <div className="qs-icons">
          {(
            [
              [Search, "search."],
              [Presentation, "Pitch."],
              [Globe, "Fly."],
              [FileText, "Rewrite."],
              [Mail, "Follow up."],
            ] as const
          ).map(([Icon, word], i) => (
            <In key={word} on={step >= i + 1} className="qs-icon">
              <span>
                <Icon aria-hidden size={30} />
              </span>
              {word}
            </In>
          ))}
        </div>
      );
    case "hope":
      return (
        <>
          <div className="qs-warm" data-on={step >= 1} />
          <div className="qs-thread" style={{ justifyItems: "start" }}>
            <In
              on={step >= 1}
              className="qs-bubble"
              style={{ borderRadius: "16px 16px 16px 4px" }}
            >
              Interesting. Send me everything you have.
            </In>
            <In on={step >= 2} className="qs-tag">
              Illustrative
            </In>
          </div>
        </>
      );
    case "bubbles":
      return (
        <div className="qs-thread">
          <In on={step >= 1} className="qs-bubble">
            Following up on the deck and data I sent.
          </In>
          <In on={step >= 2} className="qs-receipt">
            Delivered · 6 days ago
          </In>
          <In on={step >= 3} className="qs-bubble">
            Just checking in. Any thoughts?
          </In>
          <In on={step >= 4} className="qs-receipt">
            Delivered · 3 weeks ago
          </In>
        </div>
      );
    case "fadewords":
      return (
        <div className="qs-stack">
          <In on={step >= 1} off={step >= 2} className="qs-mid" as="p">
            runway
          </In>
          <In on={step >= 1} off={step >= 3} className="qs-mid" as="p">
            momentum
          </In>
          <In on={step >= 1} off={step >= 4} className="qs-mid" as="p">
            opportunity
          </In>
        </div>
      );
    case "wordmark":
      return (
        <In on className="qs-wordmark" as="p">
          Capital Q
        </In>
      );
    case "qcard":
      return <QCardScene step={step} />;
    case "split":
      return (
        <div className="qs-split">
          <In on={step >= 1} className="qs-shot">
            <Shot k="discover" />
            Investors
          </In>
          <In on={step >= 2} className="qs-shot">
            <Shot k="readiness" />
            Businesses
          </In>
        </div>
      );
    case "shots":
      return (
        <div className="qs-shots">
          {SHOTS.map(([k, word], i) => (
            <div key={k} className="qs-shot" data-on={step === i + 1}>
              <Shot k={k} />
              <b>{word}</b>
            </div>
          ))}
        </div>
      );
    case "time":
      return (
        <div className="qs-stack">
          <div className="qs-pages" data-step={step} aria-hidden>
            {["Years", "Months", "Weeks", "Week 1"].map((w, i) => (
              <div
                key={w}
                className="qs-page"
                style={{ "--i": 3 - i } as CSSProperties}
              >
                {w}
              </div>
            ))}
          </div>
          <In on={step >= 2} className="qs-mid" as="p">
            <Clock aria-hidden size={36} /> minutes
          </In>
        </div>
      );
    case "outcomes":
      return (
        <div className="qs-stack" style={{ justifyItems: "start" }}>
          {[
            "Better opportunities reach investors faster.",
            "Bad fits disappear earlier.",
            "Businesses become more investment-ready.",
            "Founders and companies spend less time chasing.",
            "Investors spend more time investing.",
          ].map((line, i) => (
            <In
              key={line}
              on={step >= i + 1}
              className="qs-mid"
              as="p"
              style={{ fontSize: "clamp(22px, 3vw, 40px)", textAlign: "start" }}
            >
              {line}
            </In>
          ))}
        </div>
      );
    case "trillions":
      return step >= 3 ? null : (
        <div className="qs-stack">
          <In on={step >= 1} off={step >= 2} className="qs-mid" as="p">
            Private capital has trillions of dollars.
          </In>
          <In on={step >= 2} className="qs-big" as="p">
            What it still doesn’t have...
          </In>
        </div>
      );
    case "channels":
      return (
        <div className="qs-channels">
          {(
            [
              [Globe, "website"],
              [FileText, "application page"],
              [Share2, "social media"],
              [Users, "accelerator"],
              [Building2, "investment programme"],
            ] as const
          ).map(([Icon, word], i) => (
            <In key={word} on={step >= i + 1} className="qs-chip">
              <Icon aria-hidden size={16} />
              {word}
            </In>
          ))}
        </div>
      );
    case "hello":
    case "silence":
    case "still":
    case "handover":
    case null:
      // Nothing on the story layer: the presence, the scrim or the real
      // page carries these beats.
      return null;
  }
}

function Rounds({ step }: { readonly step: number }) {
  const nodes = ["Seed", "Series A", "Series B", "Series C"];
  return (
    <div className="qs-rounds">
      <div className="qs-bar" data-on={step >= 3} aria-hidden />
      <div className="qs-track" style={{ "--n": 4 } as CSSProperties}>
        {nodes.map((n, i) => (
          <div
            key={n}
            className="qs-node"
            data-on={i === 0 ? step >= 1 : i === 1 ? step >= 2 : false}
            data-away={i >= 2 && step >= 10 ? true : undefined}
            style={{ "--away": `${String(i * 60)}px` } as CSSProperties}
          >
            <span className="qs-dot">
              {(i === 0 && step >= 1) || (i === 1 && step >= 2) ? (
                <Check aria-hidden size={12} />
              ) : null}
            </span>
            {n}
          </div>
        ))}
      </div>
      <div className="qs-maybes">
        {[
          "no longer works.",
          "scrutinized harder.",
          "growth slowed.",
          "the market changed.",
          "the valuation…",
        ].map((m, i) => (
          <In key={m} on={step >= i + 4} as="span">
            {m}
          </In>
        ))}
      </div>
      <svg
        className="qs-chart"
        data-on={step >= 9}
        viewBox="0 0 520 120"
        role="img"
        aria-label="A line that rises, then dips: a down round"
      >
        <polyline
          points="0,100 80,86 160,64 240,40 300,30 360,48 420,82 520,96"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  );
}

function Callback({ step }: { readonly step: number }) {
  const nodes = [
    "your first raise",
    "your fifth",
    "a Series B",
    "a down round",
    "growth capital",
  ];
  return (
    <div className="qs-rounds">
      <div className="qs-track" style={{ "--n": 5 } as CSSProperties}>
        {nodes.map((n, i) => (
          <div key={n} className="qs-node" data-on={step >= i + 1}>
            <span className="qs-dot">
              {step >= i + 1 ? <Check aria-hidden size={12} /> : null}
            </span>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

function QCardScene({ step }: { readonly step: number }) {
  const parts = [
    "your story",
    "your numbers",
    "your raise",
    "your intelligence",
    "your relationships",
  ];
  return (
    <div className="qs-cardstage">
      {step < 2 ? (
        <div className="qs-deck" data-away={step >= 2}>
          <FileText aria-hidden size={28} />
          <span>
            Deck_v14_final_FINAL_use-this-one.pdf
            <span className="qs-tag" style={{ display: "block" }}>
              “Send me your deck.”
            </span>
          </span>
        </div>
      ) : null}
      <div className="qs-card" data-on={step >= 2}>
        <QCard
          name="Kora Health"
          descriptor="Demonstration data"
          handle="kora"
          displayUrl="capitalq.app/@kora"
        />
      </div>
      <div className="qs-parts" data-on={step >= 2}>
        {parts.map((p, i) => (
          <span key={p} className="qs-part" data-on={step === i + 3}>
            {p}
          </span>
        ))}
      </div>
      {step >= 2 ? (
        <span className="qs-tag">
          The card exists; the five linked parts are proposed (plan §8.2)
        </span>
      ) : null}
    </div>
  );
}

const SHOTS: readonly (readonly [string, string])[] = [
  ["discover", "Discovery."],
  ["inbox", "Inbound."],
  ["diligence", "Intelligence."],
  ["readiness", "Readiness."],
  ["top3", "Matching."],
  ["compare", "Data."],
  ["pipeline", "Relationships."],
  ["mandate", "Execution."],
];

function Shot({ k }: { readonly k: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="qs-shot-blank" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- as above: page captures the recording run answers
    <img
      src={media(`shot-${k}.png`)}
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/* ——— Chips: foreshadowed in Act 2, paid off in Acts 4 and 5. ——— */

const MANDATE_ORDER = ["thesis", "stage", "geography", "cheque size"];

function ChipStrip({ s }: { readonly s: StoryState }) {
  if (s.chips === "none") return null;
  const n = s.chipStep;
  if (s.chips === "mismatch" || s.chips === "mandate") {
    const pass = s.chips === "mandate";
    const names = ["stage", "geography", "cheque size", "thesis"];
    return (
      <div className="qs-chips" aria-live="polite">
        {names.map((name, i) => {
          // The mandate names them in its own order: thesis first.
          const flipped = pass && MANDATE_ORDER.indexOf(name) < n;
          const shown = pass || n >= i + 1;
          return (
            <In
              key={`${name}-${String(flipped)}`}
              on={shown}
              kind={flipped ? "pass" : "miss"}
              latest={
                pass ? MANDATE_ORDER.indexOf(name) === n - 1 : i === n - 1
              }
              className={`qs-chip ${flipped ? "qs-flip" : ""}`}
            >
              {flipped ? (
                <Check aria-hidden size={16} />
              ) : (
                <X aria-hidden size={16} />
              )}
              {flipped ? `Fits: ${name}` : `Wrong ${name}`}
            </In>
          );
        })}
      </div>
    );
  }
  if (s.chips === "readiness") {
    const names = [
      "Weak governance",
      "Unclear numbers",
      "Messy structure",
      "Strong traction told badly",
    ];
    return (
      <div className="qs-chips">
        {names.map((name, i) => (
          <In
            key={name}
            on={n >= i + 1}
            kind="outline"
            latest={i === n - 1}
            className="qs-chip"
          >
            <CircleAlert aria-hidden size={16} />
            {name}
          </In>
        ))}
      </div>
    );
  }
  const findings = [
    [Check, "What is ready", "pass"],
    [AlertTriangle, "What is weak", "warn"],
    [Info, "Why it matters", "miss"],
    [CircleAlert, "What could be blocking your raise", "warn"],
  ] as const;
  return (
    <div className="qs-chips">
      {findings.map(([Icon, name, kind], i) => (
        <In
          key={name}
          on={n >= i + 1}
          kind={kind}
          latest={i === n - 1}
          className="qs-chip"
        >
          <Icon aria-hidden size={16} />
          {name}
        </In>
      ))}
    </div>
  );
}

/* ——— The real pages and the ring over them. ——— */

const Frames = memo(function Frames({
  current,
  register,
}: {
  readonly current: Frame;
  readonly register: (k: Frame, el: HTMLIFrameElement | null) => void;
}) {
  return (
    <>
      {(Object.keys(FRAMES) as Frame[]).map((k) => (
        <iframe
          key={k}
          ref={(el) => register(k, el)}
          className="qs-frame"
          data-on={k === current}
          src={FRAMES[k]}
          title={`Real page: ${k}`}
          tabIndex={-1}
          aria-hidden={k !== current}
        />
      ))}
    </>
  );
});

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The element behind a cue, by its visible text, in its own frame. */
function locate(doc: Document, target: LitTarget): Element | null {
  if (target.selector !== undefined) return doc.querySelector(target.selector);
  const want = target.text.toLowerCase();
  const groups = [
    "h1,h2,h3,h4,legend,dt,th",
    "a,button,[role=tab],summary,label",
  ];
  for (const selector of groups) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (!textOf(el).toLowerCase().startsWith(want)) continue;
      if (!target.section) return el;
      if (el.tagName === "DT") return el.parentElement ?? el;
      return el.closest("section,article,li") ?? el.parentElement ?? el;
    }
  }
  return null;
}

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

function Ring({
  target,
  frames,
  onRect,
}: {
  readonly target: LitTarget | null;
  readonly frames: RefObject<Map<Frame, HTMLIFrameElement>>;
  readonly onRect: (rect: Rect | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [foundFor, setFoundFor] = useState<LitTarget | null>(null);
  useEffect(() => {
    if (target === null) return;
    let el: Element | null = null;
    let raf = 0;
    let tries = 0;
    let last = "";
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const tick = () => {
      const frame = frames.current.get(target.frame);
      const doc = frame?.contentDocument ?? null;
      if (el === null && doc !== null && tries < 240) {
        tries += 1;
        el = locate(doc, target);
        if (el !== null) {
          const r = el.getBoundingClientRect();
          const h = frame?.clientHeight ?? 0;
          // Section navigation: bring the section to the middle, clear of
          // the captions and the review bar.
          if (r.top < 64 || r.bottom > h - 160) {
            el.scrollIntoView({
              block: "center",
              behavior: reduce ? "auto" : "smooth",
            });
          }
        }
      }
      const node = ref.current;
      if (el !== null && node !== null) {
        const r = el.getBoundingClientRect();
        node.style.transform = `translate(${String(r.left)}px, ${String(r.top)}px)`;
        node.style.width = `${String(r.width)}px`;
        node.style.height = `${String(r.height)}px`;
        // Near the bottom the captions own the space under and over the
        // ring, so its note moves beside it.
        node.dataset["place"] =
          r.bottom > window.innerHeight - 180 ? "beside" : "below";
        setFoundFor(target);
        // Q's presence follows the light; tell it only when it moved.
        const key = [r.left, r.top, r.width, r.height]
          .map((v) => Math.round(v / 8))
          .join(",");
        if (key !== last) {
          last = key;
          onRect({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, frames, onRect]);
  return (
    <div
      ref={ref}
      className="qs-ring"
      data-on={target !== null && foundFor === target}
      aria-hidden
    >
      <i />
      {target?.note === undefined ? null : (
        <span className="qs-note">{target.note}</span>
      )}
    </div>
  );
}

/* ——— Presence ——— */

/**
 * The Q page's own presence, inside the real /home: Q stands exactly there
 * while that page is the stage, and the page's copy is hidden so there is
 * one Q (display only, in this harness).
 */
function useHomeAnchor(
  frames: RefObject<Map<Frame, HTMLIFrameElement>>,
): Rect | null {
  const [anchor, setAnchor] = useState<Rect | null>(null);
  useEffect(() => {
    let timer = 0;
    const find = () => {
      const doc = frames.current.get("home")?.contentDocument;
      const canvases = Array.from(
        doc?.querySelectorAll<HTMLCanvasElement>("canvas[data-q-swarm]") ?? [],
      );
      let best: HTMLCanvasElement | null = null;
      let area = 0;
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        if (r.width * r.height > area && r.width > 160) {
          area = r.width * r.height;
          best = c;
        }
      }
      if (best === null) {
        timer = window.setTimeout(find, 400);
        return;
      }
      const r = best.getBoundingClientRect();
      best.style.visibility = "hidden";
      setAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    find();
    return () => window.clearTimeout(timer);
  }, [frames]);
  return anchor;
}

function Presence({
  s,
  speaking,
  wide,
  lit,
  home,
}: {
  readonly s: StoryState;
  readonly speaking: () => number;
  readonly wide: boolean;
  readonly lit: Rect | null;
  readonly home: Rect | null;
}) {
  const [vw, setVw] = useState(1440);
  const [vh, setVh] = useState(900);
  useEffect(() => {
    const read = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const docked = s.presence !== "centre";
  // Stage size at centre (as the Q page's own presence), dock size beside
  // the light: drawn at its size, never scaled up from a small canvas.
  const box = docked ? 240 : wide ? 380 : 260;
  const dockScale = wide ? 0.42 : 0.3;
  // (dockScale applies to the 240 px dock box.)
  const half = (box * dockScale) / 2;
  const gutter = wide ? 56 : 30;
  let cx: number;
  let cy: number;
  let scale: number;
  if (!docked) {
    // Centre stage; on the real Q page, exactly where its presence stands.
    const onHome = s.frame === "home" && s.scrim === 0 && home !== null;
    cx = onHome ? home.x + home.w / 2 : vw / 2;
    cy = onHome ? home.y + home.h / 2 : vh * (wide ? 0.4 : 0.34);
    scale = 1;
  } else if (lit !== null) {
    // Docked beside the light, on the side Q is not pointing at, level
    // with it, and never over the lit section.
    const litRight = lit.x + lit.w;
    const roomRight = vw - litRight;
    const right = roomRight >= half * 2 + 8 || lit.x < half * 2 + 8;
    cx = right
      ? Math.min(vw - gutter, litRight + half + 12)
      : Math.max(gutter, lit.x - half - 12);
    cy = Math.min(Math.max(lit.y + lit.h / 2, 110), vh - 220);
    scale = dockScale;
  } else {
    cx = s.presence === "dock-left" ? gutter : vw - gutter;
    cy = vh - (wide ? 230 : 250);
    scale = dockScale;
  }
  return (
    <div
      className="qs-presence"
      style={{
        width: box,
        height: box,
        transform: `translate(${String(cx - box / 2)}px, ${String(cy - box / 2)}px) scale(${String(scale)})`,
      }}
    >
      <QAperture
        key={s.flash}
        state={s.aperture}
        size={box - 20}
        stage={!docked}
        outputLevel={speaking}
        room={s.scene === "handover"}
        label={docked ? undefined : true}
      />
    </div>
  );
}

/* ——— Captions ——— */

function CaptionLine({
  timeline,
  t,
  visible,
}: {
  readonly timeline: Timeline;
  readonly t: number;
  readonly visible: boolean;
}) {
  const line = lineAt(timeline, t);
  if (line === null) return <div className="qs-captions" data-hidden="true" />;
  // A long line is shown a phrase at a time (display only; the words are
  // the owner's, unchanged): at most about two lines on a phone.
  const words = line.words;
  const chunks: (typeof words)[number][][] = [];
  let current: (typeof words)[number][] = [];
  for (const w of words) {
    current.push(w);
    if (current.length >= 11 && /[,.]$/.test(w.text)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);
  const chunk =
    chunks.find((c) => (c.at(-1)?.end ?? 0) >= t) ?? chunks.at(-1) ?? [];
  return (
    <div className="qs-captions" data-hidden={!visible} aria-live="off">
      <p>
        {chunk.map((w, i) => (
          <span key={`${String(i)}-${w.text}`} data-said={w.start <= t}>
            {w.text}
            {i < chunk.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
    </div>
  );
}

function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export function Storyboard() {
  const timeline = useMemo(() => buildTimeline(), []);
  const clock = useRef<Clock>({
    t: 0,
    playing: false,
    at: 0,
    base: 0,
    speed: 1,
  });
  // What the screen shows: copied from the clock when a cue or word changes.
  const [view, setView] = useState({ t: 0, playing: false });
  const show = useCallback(() => {
    setView({ t: clock.current.t, playing: clock.current.playing });
  }, []);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [wide, setWide] = useState(true);
  const framesRef = useRef(new Map<Frame, HTMLIFrameElement>());
  const [litRect, setLitRect] = useState<Rect | null>(null);
  const home = useHomeAnchor(framesRef);
  const register = useCallback((k: Frame, el: HTMLIFrameElement | null) => {
    if (el === null) framesRef.current.delete(k);
    else framesRef.current.set(k, el);
  }, []);

  const now = useCallback(() => {
    const c = clock.current;
    return c.playing
      ? c.base + ((performance.now() - c.at) / 1000) * c.speed
      : c.t;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const c = clock.current;
      c.t = Math.max(0, Math.min(t, timeline.total));
      c.base = c.t;
      c.at = performance.now();
      show();
    },
    [timeline.total, show],
  );
  const play = useCallback(() => {
    const c = clock.current;
    c.base = c.t;
    c.at = performance.now();
    c.playing = true;
    show();
  }, [show]);
  const pause = useCallback(() => {
    const c = clock.current;
    c.t = now();
    c.playing = false;
    show();
  }, [now, show]);

  // One loop: re-render only when a cue or a spoken word changes.
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const loop = () => {
      const c = clock.current;
      if (c.playing) {
        c.t = now();
        if (c.t >= timeline.total) c.playing = false;
      }
      const line = lineAt(timeline, c.t);
      const said =
        line === null ? -1 : line.words.filter((w) => w.start <= c.t).length;
      const key = `${String(cueIndexAt(timeline, c.t))}:${String(line?.source ?? -1)}:${String(said)}`;
      if (key !== lastKey) {
        lastKey = key;
        show();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [now, timeline, show]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const read = () => setWide(mq.matches);
    // Opened at ?t= (a key frame) or playing (?play=1): read once, after
    // the first paint, so the server render and hydration agree.
    const init = requestAnimationFrame(() => {
      read();
      const params = new URLSearchParams(window.location.search);
      const speed = Number(params.get("speed") ?? "1");
      clock.current.speed = Number.isFinite(speed) && speed > 0 ? speed : 1;
      const t = Number(params.get("t") ?? "0");
      seek(Number.isFinite(t) ? t : 0);
      if (params.get("play") === "1") play();
      if (params.get("captions") === "0") setCaptionsOn(false);
    });
    const beats = timeline.states.map((s, i) => ({
      t: timeline.cueTimes[i] ?? 0,
      beat: s.beat,
    }));
    window.__qstory = {
      total: timeline.total,
      seek,
      play,
      pause,
      now,
      beats: () => beats,
      seekBeat: (label) => {
        const hit = beats.find((b) => b.beat.startsWith(label));
        const at = (hit?.t ?? 0) + 0.15;
        seek(at);
        return at;
      },
    };
    mq.addEventListener("change", read);
    return () => {
      cancelAnimationFrame(init);
      mq.removeEventListener("change", read);
    };
  }, [timeline, seek, play, pause, now]);

  const t = view.t;
  const idx = cueIndexAt(timeline, t);
  const s = stateFor(timeline, idx);

  // #38: the feed advances on the word, by the page's own Next control.
  const swiped = useRef(0);
  useEffect(() => {
    const doc = framesRef.current.get("discover")?.contentDocument;
    while (doc && swiped.current < s.swipes) {
      const next = doc.querySelector<HTMLButtonElement>(
        'button[aria-label="Next company"]',
      );
      next?.click();
      swiped.current += 1;
    }
    if (s.swipes === 0) swiped.current = 0;
  }, [s.swipes]);

  const line = lineAt(timeline, t);
  const speaking = useCallback(() => {
    const c = now();
    const l = lineAt(timeline, c);
    if (l === null || c > l.end) return 0;
    return (
      0.35 + 0.3 * Math.abs(Math.sin(c * 9.3)) * Math.abs(Math.sin(c * 2.1))
    );
  }, [now, timeline]);

  const sceneKey = `${String(s.act)}-${s.scene ?? "none"}`;
  return (
    <main
      className="qs-root"
      data-mode={s.mode}
      data-scrim={s.scrim}
      aria-label="Q Story storyboard"
    >
      <Frames current={s.frame} register={register} />
      <div className="qs-scrim" aria-hidden>
        <span className="qs-scrim-day" />
        <span className="qs-scrim-night" />
      </div>
      <div className="qs-scene" key={sceneKey}>
        <SceneView s={s} />
      </div>
      <ChipStrip s={s} />
      <Ring target={s.lit} frames={framesRef} onRect={setLitRect} />
      <Presence
        s={s}
        speaking={speaking}
        wide={wide}
        lit={s.lit === null ? null : litRect}
        home={home}
      />
      <div
        className="qs-address qs-pill"
        data-on={s.scene === "trillions" && s.step >= 3}
      >
        capitalq.app/home
      </div>
      <CaptionLine
        timeline={timeline}
        t={t}
        visible={captionsOn && s.captions}
      />
      <div className="qs-hud">
        <span className="qs-pill">
          <span className="qs-wide">Storyboard ·&nbsp;</span>Act {s.act} ·{" "}
          {s.beat}
          <span className="qs-wide">
            &nbsp;· {mmss(t)} / {mmss(timeline.total)}
          </span>
        </span>
        {s.demo ? <span className="qs-pill">Demonstration data</span> : null}
        <button
          type="button"
          className="qs-btn"
          aria-label={view.playing ? "Pause" : "Play"}
          onClick={() => (view.playing ? pause() : play())}
        >
          {view.playing ? (
            <Pause aria-hidden size={16} />
          ) : (
            <Play aria-hidden size={16} />
          )}
        </button>
        <button
          type="button"
          className="qs-btn"
          aria-pressed={captionsOn}
          aria-label="Captions"
          onClick={() => setCaptionsOn((v) => !v)}
        >
          <Captions aria-hidden size={16} />
        </button>
      </div>
      {line !== null && (s.scene === "clock" || s.scene === "montage") ? (
        <span className="qs-credit">
          Photos: Pexels ({PHOTOS.desk.credit.replace("Photo by ", "")} and
          others)
        </span>
      ) : null}
    </main>
  );
}

function stateFor(timeline: Timeline, idx: number): StoryState {
  const first = timeline.states[0];
  if (first === undefined) throw new Error("empty timeline");
  if (idx < 0) {
    return {
      ...first,
      scene: null,
      aperture: "IDLE",
      beat: "Before Q speaks",
      step: 0,
    };
  }
  return timeline.states[idx] ?? first;
}
