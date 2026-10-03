"use client";

import { useState } from "react";

import type { PitchSummaryDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Download, ICON_SIZE, Play } from "@capital-q/ui/icons";

import { CompanyPitch } from "../discover/company-pitch";
import {
  recordDecisionAction,
  undoPassAction,
} from "../discover/feed/feed-actions";

import { NotScannedNote } from "../documents/not-scanned-note";
import { downloadDeckAction } from "./profile-actions";

/**
 * The interactive parts of a company's profile (founder request
 * 2026-10-02). The page decides, from the server's answer about who is
 * reading, whether any of these is rendered at all; the API refuses each
 * action for anyone else regardless.
 */

function clientEventId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 64);
}

/**
 * Pass, from the profile: optimistic, quiet (never a danger colour: a pass
 * is "not now", not a verdict), and undoable in place. One idempotency key
 * per press, reused for its one retry.
 */
export function ProfilePass({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}) {
  const [passed, setPassed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pass = async () => {
    setPassed(true);
    setNotice(null);
    const key = clientEventId("pass");
    const input = {
      companyId,
      intent: "PASS" as const,
      slateId: null,
      clientEventId: key,
      surface: "COMPANY_PROFILE" as const,
    };
    let result = await recordDecisionAction(input);
    if (!result.ok) result = await recordDecisionAction(input);
    if (!result.ok) {
      setPassed(false);
      setNotice(result.message);
    }
  };

  const undo = async () => {
    setPending(true);
    setNotice(null);
    const input = {
      companyId,
      clientEventId: clientEventId("unpass"),
      surface: "COMPANY_PROFILE" as const,
    };
    let result = await undoPassAction(input);
    if (!result.ok) result = await undoPassAction(input);
    setPending(false);
    if (result.ok) setPassed(false);
    else setNotice(result.message);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-profile-pass>
      {passed ? (
        <>
          <span className="cq-body-sm text-(--cq-text-secondary)" role="status">
            Passed on {companyName}
          </span>
          <Button
            variant="quiet"
            disabled={pending}
            onClick={() => void undo()}
          >
            Undo
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => void pass()}>
          Pass
        </Button>
      )}
      {notice === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * The deck the company shared with this reader. The link is minted on
 * press and followed by the browser straight to storage; nothing is
 * signed while the page merely shows the button.
 */
export function DeckDownload({
  companyId,
  title,
  scanned = true,
}: {
  readonly companyId: string;
  readonly title: string;
  /** False: "Not virus-scanned yet" beside it (ADR 0042). */
  readonly scanned?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const download = async () => {
    setPending(true);
    setNotice(null);
    const result = await downloadDeckAction(companyId);
    setPending(false);
    if (result.ok) window.location.assign(result.url);
    else setNotice(result.message);
  };
  return (
    <div className="flex flex-col gap-1" data-deck-download>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => void download()}
        aria-describedby="deck-title"
      >
        <Download size={ICON_SIZE.compact} aria-hidden="true" />
        Download pitch deck
      </Button>
      <span id="deck-title" className="cq-caption text-(--cq-text-tertiary)">
        {title}
      </span>
      {scanned ? null : <NotScannedNote />}
      {notice === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {notice}
        </p>
      )}
    </div>
  );
}

function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
}

/**
 * Every video this reader may play (the server already asked the player's
 * rule of each). Nothing is signed or fetched until Play: each video is a
 * labelled tile until then, and pressing Play on one mounts the only
 * player on the page, replacing any other that was playing.
 */
export function CompanyVideos({
  company,
  videos,
}: {
  readonly company: {
    readonly companyId: string;
    readonly canonicalName: string;
    readonly shortDescription: string | null;
    readonly currentStageCode: string | null;
    readonly headquartersCountry: string | null;
  };
  readonly videos: readonly PitchSummaryDto[];
}) {
  const [active, setActive] = useState<string | null>(null);
  if (videos.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        No videos you can watch yet.
      </p>
    );
  }
  return (
    <ul
      className="grid grid-cols-1 gap-6 sm:grid-cols-2"
      aria-label={`${company.canonicalName} videos`}
    >
      {videos.map((video, index) => {
        const label = video.title ?? `Video ${String(index + 1)}`;
        const length = durationLabel(video.durationSeconds);
        return (
          <li
            key={video.mediaAssetId}
            className="flex flex-col gap-2"
            data-profile-video={video.mediaAssetId}
          >
            {active === video.mediaAssetId ? (
              <CompanyPitch
                key={video.mediaAssetId}
                company={{ ...company, pitch: video }}
                startOnRequest={false}
              />
            ) : (
              <button
                type="button"
                onClick={() => setActive(video.mediaAssetId)}
                className="flex aspect-[9/16] w-full max-w-xs flex-col items-center justify-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-primary) hover:border-(--cq-border-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                aria-label={`Play ${label}`}
              >
                <Play size={ICON_SIZE.prominent} aria-hidden="true" />
                <span className="cq-body-sm">Play</span>
              </button>
            )}
            <p className="cq-body-sm text-(--cq-text-primary)">
              {label}
              {length === null ? null : (
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {" "}
                  · {length}
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
