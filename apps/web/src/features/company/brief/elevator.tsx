"use client";

import { useEffect, useRef, useState } from "react";

import type {
  PitchClaimDto,
  PitchClaimKind,
  PitchSectionFactDto,
  PitchSummaryDto,
} from "@capital-q/contracts";
import { ICON_SIZE, Play } from "@capital-q/ui/icons";

import { CompanyPitch } from "@/features/discover/company-pitch";
import { useT } from "@/features/i18n/language";

import { compactMoneyText } from "../money-text";
import { pitchMoment } from "../overview-sections";
import { plural } from "./model";
import { BriefCard, BriefGrid, Hatch, initials, QReadCard } from "./parts";

/**
 * The Elevator tab as the decision brief (ptabs "Elevator"): the pitch
 * stays a poster until Play (nothing signed or fetched before), and beside
 * it what the founders say, moment by moment, each one their claim; a
 * moment plays the video from there, muted with captions until the reader
 * turns sound on. What the pitch does not say is listed as not known yet.
 */

export type ElevatorCompany = {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly shortDescription: string | null;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
};

type Moment = {
  readonly key: string;
  readonly at: number;
  readonly kind: string;
  readonly words: string;
};

const KIND_WORDS: Readonly<Record<PitchClaimKind, string>> = {
  RAISE: "The raise",
  INSTRUMENT: "Terms",
  TRACTION: "Traction",
  USE_OF_FUNDS: "Use of funds",
  STAGE: "Stage",
};

/** What one video says, in time order, without saying a moment twice. */
export function momentsOf(
  pitchId: string,
  claims: readonly PitchClaimDto[],
  sections: readonly PitchSectionFactDto[],
): readonly Moment[] {
  const out: Moment[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    if (claim.pitchId !== pitchId) continue;
    const words =
      claim.kind === "RAISE" && claim.money !== null
        ? `“${claim.statement}”`
        : claim.kind === "INSTRUMENT" && claim.instrument !== null
          ? `${claim.instrument}.`
          : `“${claim.statement}”`;
    const id = `${String(claim.atSeconds)}:${claim.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key: `c-${id}`, at: claim.atSeconds, kind: KIND_WORDS[claim.kind], words });
  }
  for (const fact of sections) {
    if (fact.pitchId !== pitchId) continue;
    const id = `${String(fact.atSeconds)}:${fact.label}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key: `s-${id}`, at: fact.atSeconds, kind: fact.label, words: fact.value });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Wait for the player's video, then play it from `at` (muted, inline). */
function useSeek(container: HTMLElement | null, request: { at: number; n: number } | null) {
  useEffect(() => {
    if (container === null || request === null) return;
    let done = false;
    const seek = (video: HTMLVideoElement) => {
      const go = () => {
        if (done) return;
        done = true;
        video.currentTime = request.at;
        void video.play().catch(() => undefined);
      };
      if (video.readyState >= 1) go();
      else video.addEventListener("loadedmetadata", go, { once: true });
    };
    const found = container.querySelector("video");
    if (found !== null) {
      seek(found);
      return;
    }
    const watch = new MutationObserver(() => {
      const video = container.querySelector("video");
      if (video !== null) {
        watch.disconnect();
        seek(video);
      }
    });
    watch.observe(container, { childList: true, subtree: true });
    return () => {
      done = true;
      watch.disconnect();
    };
  }, [container, request]);
}

export function ElevatorBrief({
  company,
  videos,
  claims,
  sections,
  deckRaise,
  notSaid,
}: {
  readonly company: ElevatorCompany;
  readonly videos: readonly PitchSummaryDto[];
  readonly claims: readonly PitchClaimDto[];
  readonly sections: readonly PitchSectionFactDto[];
  /** The raise the deck states, to compare with the pitch; null: none. */
  readonly deckRaise: string | null;
  /** Topics the pitch does not cover, in words. */
  readonly notSaid: readonly string[];
}) {
  const t = useT();
  const [pick, setPick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [moment, setMoment] = useState<number | null>(null);
  const [request, setRequest] = useState<{ at: number; n: number } | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const counter = useRef(0);
  useSeek(frame, request);

  const video = videos[pick];
  if (video === undefined) {
    return (
      <section className="flex flex-col gap-4" aria-label="Elevator" data-profile-elevator>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("No videos you can watch yet.")}
        </p>
      </section>
    );
  }
  const moments = momentsOf(video.mediaAssetId, claims, sections);
  const length = video.durationSeconds;
  const title = video.title ?? "Elevator pitch";
  const raiseSaid = claims.find(
    (c) => c.pitchId === video.mediaAssetId && c.kind === "RAISE",
  );
  const pitchRaise =
    raiseSaid?.money === null || raiseSaid?.money === undefined
      ? null
      : compactMoneyText(raiseSaid.money);
  const playFrom = (at: number) => {
    setPlaying(true);
    setMoment(at);
    counter.current += 1;
    setRequest({ at, n: counter.current });
  };
  const same =
    pitchRaise !== null &&
    deckRaise !== null &&
    pitchRaise.toLowerCase().replace(/\.0+(?=[a-z])/u, "") ===
      deckRaise.toLowerCase().replace(/\s/gu, "").replace(/\.0+(?=[a-z])/u, "");

  const main = (
    <>
      <section className="cq-brief-card" aria-label="Elevator" data-profile-elevator>
        <div className="cq-brief-row">
          <b className="cq-brief-title">
            {plural(videos.length, "video")} and pitch{videos.length === 1 ? "" : "es"} from the
            founders
          </b>
          <span className="cq-brief-label">
            {[title, length === null ? null : pitchMoment(length)]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        </div>
        <div className="cq-brief-elev">
          <div ref={setFrame} data-profile-video={video.mediaAssetId}>
            {playing ? (
              <div className="cq-brief-player">
                <CompanyPitch
                  key={video.mediaAssetId}
                  company={{ ...company, pitch: video }}
                  startOnRequest={false}
                />
              </div>
            ) : (
              <div className="cq-brief-poster">
                <span className="pt">
                  <span className="cq-brief-av" style={{ width: 28, height: 28, fontSize: 11 }}>
                    {initials(company.canonicalName)}
                  </span>
                  {company.canonicalName}
                </span>
                <button
                  type="button"
                  className="pplay"
                  aria-label={`Play ${title}`}
                  onClick={() => playFrom(0)}
                >
                  <Play size={ICON_SIZE.prominent} aria-hidden="true" />
                </button>
                <span className="pwho">
                  <b>{title}</b>
                  {length === null ? null : <span>{pitchMoment(length)}</span>}
                </span>
              </div>
            )}
          </div>
          <div className="cq-brief-moments">
            <p className="cq-brief-label" style={{ marginBottom: 6 }}>
              {moments.length === 0
                ? t("Q hasn’t read moments from this video yet.")
                : t("What they say, moment by moment. Tap one to play from there.")}
            </p>
            {moments.map((m) => (
              <button
                key={m.key}
                type="button"
                className="cq-brief-mom"
                aria-current={moment === m.at ? "true" : undefined}
                onClick={() => playFrom(m.at)}
                data-pitch-moment={m.at}
              >
                <span className="mt">{pitchMoment(m.at)}</span>
                <span className="min-w-0">
                  <span className="mk2 block">{m.kind}</span>
                  <span className="mv block">{m.words}</span>
                </span>
                <span className="cq-brief-tag" data-tone="claim">
                  {t("Claim")}
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="cq-brief-label m-0">
          {t("The company’s own claims, from its pitch video. Not verified.")}
        </p>
        {videos.length <= 1 ? null : (
          <div className="cq-brief-chips" aria-label={t("Their videos")} role="group">
            {videos.map((v, index) => (
              <button
                key={v.mediaAssetId}
                type="button"
                aria-pressed={index === pick}
                onClick={() => {
                  setPick(index);
                  setPlaying(false);
                  setMoment(null);
                  setRequest(null);
                }}
                className="cq-brief-tag min-h-11 px-3"
                data-tone={index === pick ? "claim" : undefined}
              >
                {v.title ?? `Video ${String(index + 1)}`}
                {v.durationSeconds === null ? "" : ` · ${pitchMoment(v.durationSeconds)}`}
              </button>
            ))}
          </div>
        )}
      </section>
      {notSaid.length === 0 ? null : (
        <BriefCard data-not-said="">
          <b className="cq-brief-title">{t("Not said in the pitch")}</b>
          <div className="cq-brief-chips">
            {notSaid.map((gap) => (
              <span key={gap} className="cq-brief-tag" data-tone="gap">
                <Hatch />
                {gap}
              </span>
            ))}
          </div>
          <p className="cq-brief-label m-0">
            Unknown is not negative. These stay open until {company.canonicalName}{" "}
            answers or shares a document.
          </p>
        </BriefCard>
      )}
    </>
  );
  const rail = (
    <>
      <QReadCard>
        <p data-size="sm">
          {pitchRaise === null
            ? "The pitch doesn’t state an amount; the raise is whatever the company shares with you."
            : deckRaise === null
              ? `The pitch says ${pitchRaise}. There is no deck read to compare it with yet.`
              : same
                ? "The pitch and the deck agree on the raise."
                : `The pitch says ${pitchRaise}; the deck says ${deckRaise}. Both stand as stated until the company reconciles them.`}
        </p>
        {notSaid.length === 0 ? null : (
          <p className="qual">
            The pitch doesn’t mention {notSaid.slice(0, 2).join(" or ").toLowerCase()}, the
            first things to ask.
          </p>
        )}
      </QReadCard>
      <BriefCard title={t("About this video")}>
        <dl className="cq-brief-kv" data-cols="2">
          <div>
            <dt className="cq-brief-label">{t("Title")}</dt>
            <dd className="m-0">
              <b>{title}</b>
            </dd>
          </div>
          <div>
            <dt className="cq-brief-label">{t("Length")}</dt>
            <dd className="m-0">
              <b>{length === null ? "Not known" : pitchMoment(length)}</b>
            </dd>
          </div>
          <div>
            <dt className="cq-brief-label">{t("Captions")}</dt>
            <dd className="m-0">
              <b>{video.captionState === "AVAILABLE" ? t("On") : t("Not ready yet")}</b>
            </dd>
          </div>
          <div>
            <dt className="cq-brief-label">{t("Sound")}</dt>
            <dd className="m-0">
              <b>{t("Off until you turn it on")}</b>
            </dd>
          </div>
        </dl>
        {raiseSaid === undefined || pitchRaise === null ? null : (
          <span className="cq-brief-label">
            Where the Overview’s {pitchRaise} comes from: this video at{" "}
            {pitchMoment(raiseSaid.atSeconds)}.
          </span>
        )}
      </BriefCard>
    </>
  );
  return <BriefGrid main={main} rail={rail} />;
}
