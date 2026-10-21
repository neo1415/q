"use client";

import {
  MONTAGE_PICTURES,
  STORY_SCREENS,
  screenPath,
  storyPicture,
  type StoryMood,
  type StoryVisual,
} from "@capital-q/q-pitch";
import type { ReactNode } from "react";

import { StoryQCard } from "./story-qcard";

/**
 * The Q stage's story visuals (plan §3, "On screen"). Pure render of
 * `{visual, step, text}`: the cue engine moves the step on the word.
 * Motion is transform and opacity only (compositor), so nothing shifts
 * layout (CLS 0); under reduced motion the stylesheet drops it.
 *
 * Every figure here is illustrative or demonstration data and says so;
 * nothing claims a real company's numbers.
 */
export type StageState = {
  readonly visual: StoryVisual;
  readonly step: number;
  readonly text: string | null;
  /** The page a failed navigation would have shown (safe fallback). */
  readonly fallback: string | null;
};

export const EMPTY_STAGE: StageState = {
  visual: "none",
  step: 0,
  text: null,
  fallback: null,
};

/**
 * A small on-screen label. `shown={false}` keeps its space (visibility
 * only), so a label arriving mid-visual never moves what is around it.
 */
const Label = ({
  children,
  shown = true,
}: {
  readonly children: ReactNode;
  readonly shown?: boolean;
}) => (
  <p className="cq-story-label" data-reserved={shown ? undefined : ""}>
    {children}
  </p>
);

const DEMO = "Demonstration data";
const ILLUSTRATIVE = "Illustrative";

function Photo({
  n,
  lit = false,
}: {
  readonly n: number;
  readonly lit?: boolean;
}) {
  const picture = storyPicture(n);
  if (picture === null) return null;
  return (
    <figure className="cq-story-photo" data-lit={lit ? "" : undefined}>
      {/* Static, pre-decoded files (story-preload.ts); never a remote fetch. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static story files, decoded before playback; an optimiser would refetch them mid-story */}
      <img
        src={picture.file}
        alt={picture.alt}
        decoding="async"
        draggable={false}
      />
      <figcaption>Photo: {picture.photographer} / Pexels</figcaption>
    </figure>
  );
}

/** A full-bleed picture behind the stage's words, credited. */
function Backdrop({ n }: { readonly n: number }) {
  const picture = storyPicture(n);
  if (picture === null) return null;
  return (
    <figure className="cq-story-backdrop">
      {/* eslint-disable-next-line @next/next/no-img-element -- static story files, decoded before playback; an optimiser would refetch them mid-story */}
      <img src={picture.file} alt="" decoding="async" draggable={false} />
      <figcaption>Photo: {picture.photographer} / Pexels</figcaption>
    </figure>
  );
}

const INBOX = [
  ["deck.pdf", "Series A deck"],
  ["Intro: a founder you should meet", "Warm introduction"],
  ["Referral from a co-investor", "Referral"],
  ["New application", "Application"],
] as const;

const VERBS = [
  "Search",
  "Pitch deck",
  "Flight",
  "Rewrite",
  "Follow up",
] as const;
const CHANNELS = [
  "Website",
  "Application page",
  "Social media",
  "Accelerator",
  "Programme",
] as const;
const MISMATCH = ["Stage", "Geography", "Cheque", "Thesis"] as const;
const READINESS = ["Governance", "Numbers", "Structure", "Story"] as const;
const ROUNDS = [
  "First raise",
  "Seed",
  "Series A",
  "Series B",
  "Series C",
] as const;
const OUTCOMES = [
  "Better opportunities reach investors faster.",
  "Bad fits disappear earlier.",
  "Businesses become more investment-ready.",
  "Founders and companies spend less time chasing.",
  "Investors spend more time investing.",
] as const;

function Visual({ stage }: { readonly stage: StageState }): ReactNode {
  const { visual, step, text } = stage;
  switch (visual) {
    case "none":
      return null;
    case "aperture":
      return (
        <div className="cq-story-centre">
          <span className="cq-story-aperture" data-step={step} aria-hidden />
          {step === 2 ? (
            <p className="cq-story-type cq-story-type-sm">Q</p>
          ) : null}
        </div>
      );
    case "type":
      return (
        <>
          {/* #3: the desk at night, behind the words at a quarter strength. */}
          {step === 1 ? <Backdrop n={13} /> : null}
          <div className="cq-story-centre">
            <p className="cq-story-type" key={text ?? ""}>
              {text}
            </p>
            {step === 5 ? (
              <Label>Public market fact, not Capital Q data</Label>
            ) : null}
          </div>
        </>
      );
    case "photos":
      return (
        <div className="cq-story-centre" key={step}>
          <Photo n={step} />
        </div>
      );
    case "inbox":
      return (
        <div className="cq-story-panel">
          <p className="cq-story-kicker">Inbox</p>
          <ul className="cq-story-list">
            {INBOX.map(([title, kind], i) => (
              <li key={title} data-in={i < step ? "" : undefined}>
                <strong>{title}</strong>
                <span>{kind}</span>
              </li>
            ))}
          </ul>
          <Label>{ILLUSTRATIVE}</Label>
        </div>
      );
    case "montage":
      return (
        <div className="cq-story-montage" data-step={step}>
          {MONTAGE_PICTURES.map((picture, i) => (
            <figure
              key={picture.n}
              style={{ ["--i" as string]: i }}
              data-lit={step === 2 && i === 7 ? "" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static story files, decoded before playback; an optimiser would refetch them mid-story */}
              <img
                src={picture.file}
                alt={picture.alt}
                decoding="async"
                draggable={false}
              />
            </figure>
          ))}
          <p className="cq-story-credit">Photos: Pexels contributors</p>
        </div>
      );
    case "calendar":
      return (
        <div className="cq-story-panel">
          <p className="cq-story-kicker">This week</p>
          <ul className="cq-story-blocks">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} data-in={i < step * 3 ? "" : undefined}>
                {
                  [
                    "First call",
                    "Intro call",
                    "Deck review",
                    "First call",
                    "Catch-up",
                    "Intro call",
                  ][i]
                }
              </li>
            ))}
          </ul>
          <Label>{ILLUSTRATIVE}</Label>
        </div>
      );
    case "questions":
      return (
        <div className="cq-story-centre cq-story-stack">
          <p className="cq-story-type" data-in="">
            Is this worth the risk?
          </p>
          <p className="cq-story-type" data-in={step >= 2 ? "" : undefined}>
            Do I trust this business?
          </p>
        </div>
      );
    case "scale":
      return (
        <div className="cq-story-centre">
          <div className="cq-story-scale" data-step={step}>
            <div>
              <span className="cq-story-weight" />
              <p>A bad investment</p>
            </div>
            <div>
              <span className="cq-story-weight" data-unknown="" />
              <p>A great one never found</p>
            </div>
          </div>
          <Label shown={step >= 3}>Unknown stays unknown</Label>
        </div>
      );
    case "timeline":
      return (
        <div className="cq-story-panel cq-story-wide">
          <ol className="cq-story-timeline" data-step={step}>
            {ROUNDS.map((round, i) => (
              <li
                key={round}
                data-in={
                  (step >= 1 && i <= 1) || (step >= 2 && i === 2) || step >= 5
                    ? ""
                    : undefined
                }
                data-lit={
                  (step === 6 && i === 0) ||
                  (step === 7 && i === 1) ||
                  (step === 8 && i === 3) ||
                  (step === 9 && i === 2) ||
                  (step === 10 && i === 4)
                    ? ""
                    : undefined
                }
                data-far={step === 4 && i >= 3 ? "" : undefined}
              >
                <span aria-hidden />
                {round}
              </li>
            ))}
          </ol>
          <p
            className="cq-story-bar"
            data-reserved={step === 3 || step === 4 ? undefined : ""}
          >
            The bar is higher
          </p>
          {step >= 6 ? (
            <Label>Every stage, one associate</Label>
          ) : (
            <Label>{ILLUSTRATIVE}</Label>
          )}
        </div>
      );
    case "chart-dip":
      return (
        <div className="cq-story-panel">
          <svg
            viewBox="0 0 240 100"
            className="cq-story-chart"
            data-step={step}
            aria-hidden
          >
            <path d="M8 80 L60 62 L110 40 L150 28" className="cq-story-line" />
            <path
              d="M150 28 L190 58 L232 76"
              className="cq-story-line cq-story-dip"
            />
          </svg>
          <p className="cq-story-kicker">Valuation</p>
          <Label>{ILLUSTRATIVE}</Label>
        </div>
      );
    case "icons":
      if (step >= 11) {
        return (
          <div className="cq-story-panel cq-story-dockside">
            <p className="cq-story-kicker">Where GateQ goes</p>
            <ul className="cq-story-chips">
              {CHANNELS.map((channel, i) => (
                <li key={channel} data-in={i < step - 10 ? "" : undefined}>
                  {channel}
                </li>
              ))}
            </ul>
          </div>
        );
      }
      return (
        <div className="cq-story-centre">
          <ul className="cq-story-chips cq-story-chips-lg">
            {VERBS.map((verb, i) => (
              <li key={verb} data-in={i < step ? "" : undefined}>
                {verb}
              </li>
            ))}
          </ul>
        </div>
      );
    case "warmth":
      return <div className="cq-story-warmth" data-step={step} aria-hidden />;
    case "bubbles":
      return (
        <div className="cq-story-panel">
          <ul className="cq-story-bubbles">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} data-in={i < step + 1 ? "" : undefined}>
                {
                  [
                    "Following up on our call",
                    "Just checking in",
                    "Any update?",
                  ][i]
                }
                <span>Sent</span>
              </li>
            ))}
          </ul>
          <Label>{ILLUSTRATIVE}</Label>
        </div>
      );
    case "fade-words":
      return (
        <div className="cq-story-centre">
          <ul className="cq-story-fade" data-step={step}>
            <li>runway</li>
            <li>momentum</li>
            <li>opportunity</li>
          </ul>
        </div>
      );
    case "chips-mismatch":
      return (
        <div
          className={
            step > 4 ? "cq-story-panel cq-story-dockside" : "cq-story-centre"
          }
        >
          <ul className="cq-story-chips cq-story-chips-lg">
            {MISMATCH.map((chip, i) => {
              // #36 pays #30 off: the chips return and turn to ticks
              // (Stage, Geography, Cheque, Thesis as the words come).
              const order = [6, 7, 8, 5][i] ?? 99;
              const matched = step >= order;
              return (
                <li
                  key={chip}
                  data-in={step > 4 || i < step ? "" : undefined}
                  data-tone={matched ? "match" : "miss"}
                >
                  <span aria-hidden>{matched ? "✓" : "✕"}</span> {chip}
                  <span className="cq-sr-only">
                    {matched ? "matched" : "mismatched"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "chips-readiness":
      return (
        <div className="cq-story-centre">
          <ul className="cq-story-chips cq-story-chips-lg cq-story-chips-outline">
            {READINESS.map((chip, i) => (
              <li key={chip} data-in={i < step ? "" : undefined}>
                {chip}
              </li>
            ))}
          </ul>
        </div>
      );
    case "wordmark":
      return (
        <div className="cq-story-centre">
          <p className="cq-story-wordmark">Capital Q</p>
        </div>
      );
    case "top-three":
      return (
        <div className="cq-story-panel cq-story-dockside">
          <p className="cq-story-kicker">
            Your top three, against your mandate
          </p>
          <ol className="cq-story-cards">
            {[
              ["Harbourline Cargo", "Strong fit", "Investable"],
              ["Clinicrest", "Good fit", "Developing"],
              ["Maji Loop", "Good fit", "Early"],
            ].map(([name, fit, inv], i) => (
              <li key={name} style={{ ["--i" as string]: i }}>
                <strong>{name}</strong>
                <span>Suitability: {fit}</span>
                <span>Investability: {inv}</span>
              </li>
            ))}
          </ol>
          <Label>{DEMO}</Label>
        </div>
      );
    case "comparison":
      return (
        <div className="cq-story-panel cq-story-dockside">
          <p className="cq-story-kicker">Side by side</p>
          <table className="cq-story-table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Harbourline Cargo</th>
                <th scope="col">Clinicrest</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Stage</th>
                <td>Seed</td>
                <td>Pre-seed</td>
              </tr>
              <tr>
                <th scope="row">Fit</th>
                <td>Strong</td>
                <td>Good</td>
              </tr>
              <tr>
                <th scope="row">Evidence</th>
                <td>Document supported</td>
                <td>Self reported</td>
              </tr>
            </tbody>
          </table>
          <Label>{DEMO}</Label>
        </div>
      );
    case "investiq":
      return (
        <div className="cq-story-panel">
          <p className="cq-story-kicker">Investability IQ</p>
          <ul className="cq-story-findings">
            {[
              ["Ready", "Customers and revenue are documented"],
              ["Weak", "Governance: no independent board member"],
              ["Why it matters", "Investors at Series A look for it first"],
              [
                "Could block the raise",
                "Numbers in the deck and the model disagree",
              ],
            ].map(([kind, line], i) => (
              <li
                key={kind}
                data-in={i < step ? "" : undefined}
                data-tone={i === 0 ? "ready" : i === 3 ? "block" : "weak"}
              >
                <strong>{kind}</strong>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Label>{DEMO} · methodology proposed, not a certified score</Label>
        </div>
      );
    case "investor-matches":
      return (
        <div className="cq-story-panel">
          <p className="cq-story-kicker">Investors you genuinely suit</p>
          <ol className="cq-story-cards" data-step={step}>
            {[
              ["Savanna Seed Partners", "Invests at your stage and sector"],
              ["Sahel Bridge Ventures", "Your geography, your cheque size"],
              ["A demo angel syndicate", "Thesis close to your model"],
            ].map(([name, why], i) => (
              <li
                key={name}
                style={{ ["--i" as string]: i }}
                data-lit={step >= 2 && i === 0 ? "" : undefined}
              >
                <strong>{name}</strong>
                <span>{why}</span>
              </li>
            ))}
          </ol>
          <Label>{DEMO}</Label>
        </div>
      );
    case "deck-to-card":
      // #48: "Send me your deck." The deck, then it slides away.
      return (
        <div className="cq-story-centre">
          <div className="cq-story-deck" data-gone={step >= 2 ? "" : undefined}>
            <span aria-hidden>PDF</span>
            <strong>deck_final_v7.pdf</strong>
          </div>
        </div>
      );
    case "q-card":
      // #48-49: the product's real Q Card page, demonstration company.
      return (
        <div className="cq-story-panel cq-story-card-panel">
          <StoryQCard />
          <Label>{DEMO} · a fictional company&apos;s Q Card</Label>
        </div>
      );
    case "split":
      return (
        <div className="cq-story-centre">
          <div className="cq-story-split">
            <div>
              <p className="cq-story-kicker">Investors</p>
              <p>Discover · Diligence · GateQ</p>
            </div>
            <div>
              <p className="cq-story-kicker">Businesses</p>
              <p>Readiness · Matching · Q Card</p>
            </div>
          </div>
        </div>
      );
    case "screens":
      return (
        <div className="cq-story-centre">
          <div className="cq-story-screens">
            {STORY_SCREENS.map((name, i) => (
              <figure key={name} data-in={i === step - 1 ? "" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static story files, decoded before playback; an optimiser would refetch them mid-story */}
                <img
                  src={screenPath(name)}
                  alt={`Capital Q: ${name}`}
                  decoding="async"
                  draggable={false}
                />
                <figcaption>
                  {name[0]?.toUpperCase()}
                  {name.slice(1)}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    case "stopwatch":
      return (
        <div className="cq-story-centre">
          <div className="cq-story-stopwatch" data-step={step}>
            <span className="cq-story-pages" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <p className="cq-story-type" key={step >= 2 ? "after" : "before"}>
              {step >= 2 ? "Minutes" : "Weeks · months · years"}
            </p>
          </div>
        </div>
      );
    case "lines":
      return (
        <div className="cq-story-centre">
          <ul className="cq-story-outcomes">
            {OUTCOMES.map((line, i) => (
              <li key={line} data-in={i < step ? "" : undefined}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}

function visualKey({ visual, step, text }: StageState): string {
  if (visual === "chips-mismatch") {
    return `${visual}:${step > 4 ? "dock" : "centre"}`;
  }
  if (visual === "icons")
    return `${visual}:${step >= 11 ? "channels" : "verbs"}`;
  if (visual === "type") return `${visual}:${text ?? ""}`;
  return visual;
}

export function StoryStage({
  stage,
  mood,
}: {
  readonly stage: StageState;
  readonly mood: StoryMood;
}) {
  return (
    <div className="cq-story-stage" data-mood={mood} data-visual={stage.visual}>
      {stage.fallback !== null ? (
        <div className="cq-story-panel cq-story-dockside">
          <p className="cq-story-kicker">Shown here instead</p>
          <p>{stage.fallback} did not open in time, so Q carries on here.</p>
        </div>
      ) : null}
      {/* One element per visual and layout: a change of either mounts a new
          block (an entrance), never moves the old one (CLS 0). */}
      <Visual key={visualKey(stage)} stage={stage} />
    </div>
  );
}
