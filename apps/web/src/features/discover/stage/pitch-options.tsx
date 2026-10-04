"use client";

import { useState } from "react";

import type { PitchSummaryDto } from "@capital-q/contracts";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";
import {
  ArrowDown,
  Captions,
  Download,
  EyeOff,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
} from "@capital-q/ui/icons";

import { authoriseDownloadAction } from "../feed/playback-source";
import { formatTime } from "./scrubber";
import { PLAYBACK_RATES, rateLabel, type PlaybackRate } from "./playback-rate";

/**
 * A pitch's options (Discover v2): a long press on the pitch, or More on
 * the rail, opens them; on a desktop, More or a right-click. Speed is the
 * viewer's own and stays on this device. Download is offered only when the
 * founder allows it, and the server decides again when it is asked. There
 * is no Report here until a report contract exists.
 *
 * The sheet is portalled outside the stage, so it reads in the app's own
 * theme: a reading surface, not part of the cinema.
 */

type DownloadState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "WORKING" }
  | { readonly kind: "DONE"; readonly message: string };

/** Open the CDN's link: the file comes from there, never through the app. */
function openDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

const optionRow =
  "flex min-h-14 w-full items-center gap-3.5 rounded-md px-2 text-left text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) active:scale-[0.99] disabled:cursor-default disabled:hover:bg-transparent";

export function PitchOptionsSheet({
  open,
  onOpenChange,
  companyId,
  companyName,
  pitch,
  rate,
  onRate,
  captionsOn,
  onCaptionsChange,
  onClearDisplay,
  onNotInterested,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly companyId: string;
  readonly companyName: string;
  readonly pitch: PitchSummaryDto;
  readonly rate: PlaybackRate;
  readonly onRate: (rate: PlaybackRate) => void;
  readonly captionsOn: boolean;
  readonly onCaptionsChange: (on: boolean) => void;
  readonly onClearDisplay: () => void;
  /** Pass, under the words people use for it; absent where Pass is not a choice. */
  readonly onNotInterested?: (() => void) | undefined;
}) {
  const [download, setDownload] = useState<DownloadState>({ kind: "IDLE" });
  const captionsAvailable = pitch.captionState === "AVAILABLE";
  const allowed = pitch.downloadAllowed === true;
  const title = pitch.title ?? "Pitch";
  const duration =
    pitch.durationSeconds === null ? null : formatTime(pitch.durationSeconds);

  const startDownload = async () => {
    setDownload({ kind: "WORKING" });
    const result = await authoriseDownloadAction(companyId, pitch.mediaAssetId);
    if (!result.ok) {
      setDownload({ kind: "DONE", message: result.message });
      return;
    }
    if (result.value.status === "PREPARING") {
      setDownload({
        kind: "DONE",
        message: "The file is being prepared. Try again in a minute.",
      });
      return;
    }
    openDownload(result.value.downloadUrl);
    setDownload({ kind: "DONE", message: "Download started." });
  };

  return (
    <SheetRoot
      open={open}
      onOpenChange={(next) => {
        if (!next) setDownload({ kind: "IDLE" });
        onOpenChange(next);
      }}
    >
      <SheetContent
        title={`${companyName} · ${title}`}
        {...(duration === null ? {} : { description: duration })}
        side="bottom"
        // A small panel beside the decisions on a desktop, a sheet on a phone.
        className="lg:inset-x-auto lg:right-6 lg:bottom-6 lg:left-auto lg:w-[360px] lg:rounded-xl lg:pb-0"
      >
        <div
          className="flex flex-col gap-1"
          data-pitch-options
          // In a portal, but inside the feed in React's tree: its keys and
          // gestures stay here.
          onKeyDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <p
            className="cq-label px-2 pt-1 pb-2 text-(--cq-text-secondary)"
            id="cq-pitch-speed"
          >
            Playback speed
          </p>
          <div
            role="radiogroup"
            aria-labelledby="cq-pitch-speed"
            className="grid grid-cols-6 gap-1.5 px-2 pb-3"
            data-pitch-speed
          >
            {PLAYBACK_RATES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === rate}
                onClick={() => onRate(option)}
                className={`cq-numeric min-h-11 rounded-md text-sm transition-[background-color,transform] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) active:scale-[0.97] ${
                  option === rate
                    ? "bg-(--cq-text-primary) font-semibold text-(--cq-surface-raised)"
                    : "bg-(--cq-surface-subtle) text-(--cq-text-primary) hover:bg-(--cq-surface-strong)"
                }`}
              >
                {rateLabel(option)}
              </button>
            ))}
          </div>

          <div className="border-t border-(--cq-border-subtle) pt-1">
            {allowed ? (
              <button
                type="button"
                className={optionRow}
                disabled={download.kind === "WORKING"}
                onClick={() => void startDownload()}
                data-pitch-download
              >
                <Download
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                  className="shrink-0 text-(--cq-text-secondary)"
                />
                <span className="flex flex-col">
                  <span className="cq-body">
                    {download.kind === "WORKING"
                      ? "Getting the file…"
                      : "Download pitch"}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    Saves a copy to this device
                  </span>
                </span>
              </button>
            ) : (
              <div
                className={`${optionRow} hover:bg-transparent`}
                data-pitch-download-off
              >
                <Lock
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                  className="shrink-0 text-(--cq-text-tertiary)"
                />
                <span className="flex flex-col">
                  <span className="cq-body text-(--cq-text-secondary)">
                    Download not allowed by the company
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {companyName} has kept this pitch watch-only
                  </span>
                </span>
              </div>
            )}
            <p className="sr-only" role="status">
              {download.kind === "DONE" ? download.message : ""}
            </p>
            {download.kind === "DONE" ? (
              <p
                className="cq-caption px-2 pb-1 text-(--cq-text-secondary)"
                aria-hidden="true"
              >
                {download.message}
              </p>
            ) : null}

            <button
              type="button"
              role="switch"
              aria-checked={captionsAvailable && captionsOn}
              disabled={!captionsAvailable}
              className={optionRow}
              onClick={() => onCaptionsChange(!captionsOn)}
              data-pitch-captions-toggle
            >
              <Captions
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
                className="shrink-0 text-(--cq-text-secondary)"
              />
              <span className="flex flex-1 flex-col">
                <span className="cq-body">Captions</span>
                {captionsAvailable ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    Not available for this pitch yet
                  </span>
                )}
              </span>
              <span
                aria-hidden="true"
                className="cq-switch"
                data-on={captionsAvailable && captionsOn ? "" : undefined}
              />
            </button>

            <button
              type="button"
              className={optionRow}
              onClick={() => {
                onOpenChange(false);
                onClearDisplay();
              }}
              data-pitch-clear-display
            >
              <EyeOff
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
                className="shrink-0 text-(--cq-text-secondary)"
              />
              <span className="flex flex-col">
                <span className="cq-body">Clear display</span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  Hide everything over the video until you tap
                </span>
              </span>
            </button>

            {onNotInterested === undefined ? null : (
              <div
                aria-hidden="true"
                className="mx-2 my-1 h-px bg-(--cq-border-subtle)"
              />
            )}
            {onNotInterested === undefined ? null : (
              <button
                type="button"
                className={optionRow}
                onClick={() => {
                  onOpenChange(false);
                  onNotInterested();
                }}
                data-pitch-not-interested
              >
                <ArrowDown
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                  className="shrink-0 text-(--cq-text-secondary)"
                />
                <span className="flex flex-col">
                  <span className="cq-body">Not interested</span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    Same as Pass: moves on and records your pass
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
