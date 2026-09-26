"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type {
  CompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Check, ICON_SIZE, Play, X } from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { PitchPlayer } from "@/features/discover/player/pitch-player";
import { prefersReducedMotion } from "@/features/discover/player/use-pitch-playback";

import {
  authorisePitchPlaybackAction,
  deletePitchMediaAction,
  listPitchMediaAction,
} from "./pitch-actions";
import {
  asDiscovered,
  toPitchVersionRows,
  type PitchVersionRow,
} from "./pitch-library-state";

/**
 * Every version of the company's pitch (VID): what is current, what is
 * published, what was replaced, what failed and what was withdrawn, each
 * with its poster, length, upload date and captions.
 *
 * Nothing here is decided in the browser. The list is the server's
 * `GET /media` under the founder's own session; a poster and a preview
 * come from the same signed playback route Discover uses, which the
 * server authorises for the owner and nobody else while a version is
 * private; a withdrawal is `DELETE`, which needs `media.manage` on the
 * server whatever this screen shows. Hairline rows, no cards (ADR 0017).
 */

export type PitchLibraryProps = {
  readonly companyId: string;
  readonly company: CompanyDto | null;
  /** Bumped by the page when the current pitch changed elsewhere. */
  readonly refreshKey: number;
  /** Told when a withdrawal here changed which pitch is current. */
  readonly onCurrentChanged: () => void;
  /**
   * Told when a version's preview opens or closes, so the page keeps one
   * active player (doc 20): the current pitch's preview above holds.
   */
  readonly onPreviewChange?: ((open: boolean) => void) | undefined;
};

/** Posters are minted grants: ask for the few a founder is likely to look at. */
const POSTER_BUDGET = 6;

type Posters = Readonly<Record<string, string | null>>;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function PitchLibrary({
  companyId,
  company,
  refreshKey,
  onCurrentChanged,
  onPreviewChange,
}: PitchLibraryProps) {
  const [rows, setRows] = useState<readonly PitchVersionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posters, setPosters] = useState<Posters>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    onPreviewChange?.(previewing !== null);
  }, [previewing, onPreviewChange]);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );

  useEffect(() => {
    let cancelled = false;
    void listPitchMediaAction(companyId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      setRows(toPitchVersionRows(result.value));
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, refreshKey, reload]);

  // Posters for the first few playable versions, each through the owner's
  // own signed grant. A refusal leaves the row without a poster, never
  // with a guessed URL.
  const wanted = (rows ?? [])
    .filter((row) => row.previewable)
    .slice(0, POSTER_BUDGET)
    .map((row) => row.pitch.mediaAssetId)
    .join(",");
  useEffect(() => {
    if (wanted === "") return;
    let cancelled = false;
    for (const mediaAssetId of wanted.split(",")) {
      void authorisePitchPlaybackAction(companyId, mediaAssetId).then(
        (result) => {
          if (cancelled) return;
          setPosters((known) => ({
            ...known,
            [mediaAssetId]: result.ok ? result.value.posterUrl : null,
          }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [companyId, wanted]);

  const authorize = useCallback(
    async (mediaAssetId: string): Promise<PlaybackAuthorizationDto> => {
      const result = await authorisePitchPlaybackAction(
        companyId,
        mediaAssetId,
      );
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
    [companyId],
  );

  const withdraw = useCallback(
    async (row: PitchVersionRow) => {
      setWorking(row.pitch.mediaAssetId);
      setNotice(null);
      const result = await deletePitchMediaAction(
        companyId,
        row.pitch.mediaAssetId,
      );
      setWorking(null);
      setConfirming(null);
      if (!result.ok) {
        setNotice(
          result.status === 403
            ? "Only an administrator of your organisation can withdraw a pitch."
            : result.message,
        );
        return;
      }
      if (previewing === row.pitch.mediaAssetId) setPreviewing(null);
      setReload((value) => value + 1);
      if (row.isCurrent) onCurrentChanged();
    },
    [companyId, onCurrentChanged, previewing],
  );

  if (loadError !== null) {
    return (
      <InlineNotice tone="warning" title="Your pitch history couldn't load">
        {loadError}
      </InlineNotice>
    );
  }
  if (rows === null) return <Skeleton lines={3} />;
  if (rows.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        No versions yet. The first video you upload appears here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice !== null ? (
        <InlineNotice tone="warning">{notice}</InlineNotice>
      ) : null}
      <ul
        className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
        data-pitch-library
      >
        {rows.map((row) => {
          const id = row.pitch.mediaAssetId;
          const poster = posters[id] ?? null;
          const busy = working === id;
          return (
            <li
              key={id}
              className="flex flex-col gap-3 py-4"
              data-pitch-version={id}
              data-phase={row.phase}
            >
              <div className="flex gap-4">
                <div
                  className="relative aspect-9/16 w-16 shrink-0 overflow-hidden rounded-(--cq-radius-sm) bg-(--cq-surface-subtle)"
                  aria-hidden="true"
                >
                  {poster !== null ? (
                    // A signed poster straight from the video service: no
                    // media through the app's image optimiser (doc 20).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={poster}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="cq-body font-medium text-(--cq-text-primary)">
                      {row.isCurrent ? "Current pitch" : "Earlier version"}
                    </span>
                    <span className="cq-status-line">
                      {row.isPublished ? (
                        <Check size={ICON_SIZE.compact} aria-hidden="true" />
                      ) : null}
                      {row.phaseLabel}
                    </span>
                  </p>
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    {row.standing}
                  </p>
                  <p className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                    Uploaded {row.uploadedOn}
                    {row.duration === null ? "" : ` · ${row.duration}`}
                    {row.pitch.aspectRatio === null
                      ? ""
                      : ` · ${row.pitch.aspectRatio}`}
                    {` · ${row.captions}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {row.previewable && company !== null ? (
                  <Button
                    variant="secondary"
                    aria-expanded={previewing === id}
                    aria-controls={`pitch-preview-${id}`}
                    onClick={() =>
                      setPreviewing((open) => (open === id ? null : id))
                    }
                  >
                    {previewing === id ? (
                      <X size={ICON_SIZE.regular} aria-hidden="true" />
                    ) : (
                      <Play size={ICON_SIZE.regular} aria-hidden="true" />
                    )}
                    {previewing === id ? "Close preview" : "Preview"}
                  </Button>
                ) : null}
                {row.withdrawable ? (
                  confirming === id ? (
                    <span
                      className="flex flex-wrap items-center gap-2"
                      role="group"
                      aria-label="Confirm withdrawal"
                    >
                      <span className="cq-body-sm text-(--cq-text-primary)">
                        {row.isCurrent
                          ? "Withdraw your current pitch? Investors stop seeing it now."
                          : "Withdraw this version? It can't be played again."}
                      </span>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void withdraw(row)}
                      >
                        Withdraw
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Keep it
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="quiet"
                      disabled={working !== null}
                      onClick={() => setConfirming(id)}
                    >
                      Withdraw
                    </Button>
                  )
                ) : null}
              </div>

              {previewing === id && company !== null ? (
                <div
                  id={`pitch-preview-${id}`}
                  className="w-full max-w-(--cq-layout-narrow) overflow-hidden rounded-(--cq-radius-md) bg-(--cq-stage-surface)"
                >
                  <PitchPlayer
                    company={asDiscovered(company, row.pitch)}
                    policy="ACTIVE"
                    authorize={authorize}
                    reducedMotion={reducedMotion}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="cq-caption text-(--cq-text-tertiary)">
        Replacing a pitch keeps the earlier version here. Withdrawing one
        removes the video from the video service; the record that it existed
        stays in your history.
      </p>
    </div>
  );
}
