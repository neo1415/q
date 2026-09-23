"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";

import type {
  CompanyDto,
  DiscoveredCompanyDto,
  MediaAssetDto,
  PitchGuidance,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Check, Eye, ICON_SIZE, Upload } from "@capital-q/ui/icons";
import { InlineNotice, Progress, Skeleton } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { PitchPlayer } from "@/features/discover/player/pitch-player";
import { prefersReducedMotion } from "@/features/discover/player/use-pitch-playback";

import {
  authorisePitchPlaybackAction,
  createPitchAction,
  createUploadSessionAction,
  loadPitchOverviewAction,
  syncPitchAction,
} from "./pitch-actions";
import {
  describeNetworkStanding,
  INITIAL_PITCH_FLOW,
  judgeFile,
  pitchFlowReducer,
  replaceablePitch,
  SYNC_MAX_ATTEMPTS,
  syncDelayMs,
  type ChosenFile,
  type PitchFlowState,
} from "./pitch-state";
import { uploadBytes } from "./upload-bytes";

/**
 * The founder's pitch upload (CQ-WEB-023; doc 17 §35; doc 20 §9–§14).
 *
 * One file control, one honest status line, and a preview when there is
 * something to preview. The bytes go from this browser to the provider's
 * one-time target and nowhere else; every other step is a server action
 * under the founder's own session, and the screen only ever repeats what
 * the server's record says. Nothing here spins for effect: while the
 * provider encodes, the line says so and the page polls politely.
 */

export type PitchUploadProps = {
  readonly companyId: string;
};

/**
 * The preview's answer, remembered against the asset it was asked for. A
 * different asset (a replacement) reads as unknown without any reset: the
 * key does the forgetting, so no effect has to.
 */
type Preview =
  | {
      readonly kind: "AVAILABLE";
      readonly mediaAssetId: string;
      readonly first: PlaybackAuthorizationDto;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly mediaAssetId: string;
      readonly reason: string;
    };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !("matchMedia" in window)) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function chosen(file: File): ChosenFile {
  return { name: file.name, sizeBytes: file.size, mimeType: file.type };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0
    ? `${String(rest)}s`
    : `${String(minutes)}m ${String(rest).padStart(2, "0")}s`;
}

/** The feed's view of this company, for the player it shares with Discover. */
function asDiscovered(
  company: CompanyDto,
  pitch: MediaAssetDto,
): DiscoveredCompanyDto {
  return {
    companyId: company.id,
    canonicalName: company.canonicalName,
    websiteUrl: company.websiteUrl,
    headquartersCountry: company.headquartersCountry,
    currentStageCode: company.currentStageCode,
    shortDescription: company.shortDescription,
    reasons: [],
    reasonCodes: [],
    pitch: {
      mediaAssetId: pitch.mediaAssetId,
      aspectRatio: pitch.aspectRatio,
      durationSeconds: pitch.durationSeconds,
      captionState: pitch.captionState,
    },
  };
}

export function PitchUpload({ companyId }: PitchUploadProps) {
  const [flow, dispatch] = useReducer(pitchFlowReducer, INITIAL_PITCH_FLOW);
  const [company, setCompany] = useState<CompanyDto | null>(null);
  const [guidance, setGuidance] = useState<PitchGuidance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  // The OS preference, read as an external store: the server renders
  // "not reduced" and the client corrects it on hydration without a
  // state update of its own.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );

  // The overview, on mount and whenever the company changes. State is
  // set only in the callback, once the server has answered.
  useEffect(() => {
    let cancelled = false;
    void loadPitchOverviewAction(companyId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      setCompany(result.value.company);
      dispatch({ type: "LOADED", pitch: result.value.pitch });
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Polite polling while the provider works. The delay grows with each
  // answer that is not yet READY, and the loop stops on any resting state
  // or when the page gives up asking.
  useEffect(() => {
    if (flow.kind !== "PROCESSING") return;
    const { attempt } = flow;
    const mediaAssetId = flow.pitch.mediaAssetId;
    const timer = setTimeout(() => {
      if (attempt >= SYNC_MAX_ATTEMPTS) {
        dispatch({
          type: "REQUEST_FAILED",
          message:
            "The video service is taking longer than expected. Reload this page later to check again.",
        });
        return;
      }
      void syncPitchAction(companyId, mediaAssetId).then((result) => {
        if (result.ok) dispatch({ type: "SYNCED", pitch: result.value });
        else dispatch({ type: "REQUEST_FAILED", message: result.message });
      });
    }, syncDelayMs(attempt));
    return () => clearTimeout(timer);
  }, [companyId, flow]);

  // Once READY, the company's own record decides what the screen may say
  // about investors, and the preview asks the server for a grant once —
  // rendering the player only when there is a real one. A replacement
  // pitch has a new id, so the remembered answer no longer applies to it.
  const readyAssetId = flow.kind === "READY" ? flow.pitch.mediaAssetId : null;
  useEffect(() => {
    if (readyAssetId === null) return;
    let cancelled = false;
    void loadPitchOverviewAction(companyId).then((result) => {
      if (!cancelled && result.ok) setCompany(result.value.company);
    });
    void authorisePitchPlaybackAction(companyId, readyAssetId).then(
      (result) => {
        if (cancelled) return;
        setPreview(
          result.ok
            ? {
                kind: "AVAILABLE",
                mediaAssetId: readyAssetId,
                first: result.value,
              }
            : {
                kind: "UNAVAILABLE",
                mediaAssetId: readyAssetId,
                reason: result.message,
              },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [companyId, readyAssetId]);

  const authorize = useCallback(
    async (mediaAssetId: string) => {
      const result = await authorisePitchPlaybackAction(
        companyId,
        mediaAssetId,
      );
      if (!result.ok) {
        setPreview({
          kind: "UNAVAILABLE",
          mediaAssetId,
          reason: result.message,
        });
        throw new Error(result.message);
      }
      return result.value;
    },
    [companyId],
  );

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file === undefined) return;
      const verdict = judgeFile(chosen(file), guidance);
      if (!verdict.ok) {
        setFileNotice(verdict.message);
        return;
      }
      setFileNotice(null);
      const replaces = replaceablePitch(flow);
      const reuse = flow.kind === "CREATED" ? flow.pitch : null;
      dispatch({ type: "FILE_CHOSEN", file: chosen(file) });

      // 1. The record. Reused when a CREATED one already exists; created,
      //    replacing the current pitch by name, otherwise.
      let record: MediaAssetDto | null = reuse;
      if (record === null) {
        const created = await createPitchAction(
          companyId,
          replaces === null || replaces.status === "CREATED"
            ? null
            : replaces.mediaAssetId,
        );
        if (!created.ok) {
          dispatch({ type: "REQUEST_FAILED", message: created.message });
          return;
        }
        setGuidance(created.value.guidance);
        record = created.value.pitch;
        dispatch({ type: "CREATED", pitch: record });
      }

      // 2. The one-time target, against the version this screen saw.
      const reserved = await createUploadSessionAction(
        companyId,
        record.mediaAssetId,
        record.version,
      );
      if (!reserved.ok) {
        dispatch({ type: "REQUEST_FAILED", message: reserved.message });
        return;
      }
      dispatch({
        type: "RESERVED",
        pitch: reserved.value.pitch,
        session: reserved.value,
      });

      // 3. The bytes, browser → provider. Nothing of Capital Q's in between.
      const controller = new AbortController();
      uploadAbort.current = controller;
      const outcome = await uploadBytes({
        uploadUrl: reserved.value.uploadUrl,
        file,
        signal: controller.signal,
        onProgress: (progress) =>
          dispatch({ type: "UPLOAD_PROGRESS", progress }),
      });
      uploadAbort.current = null;
      if (outcome.kind === "DONE") {
        dispatch({ type: "UPLOADED" });
      } else if (outcome.kind === "ABORTED") {
        // The person left; the record stays UPLOAD_PENDING and the next
        // load says so honestly.
        return;
      } else {
        dispatch({
          type: "REQUEST_FAILED",
          message: "",
          failure: "UPLOAD_FAILED",
        });
      }
    },
    [companyId, flow, guidance],
  );

  useEffect(() => () => uploadAbort.current?.abort(), []);

  if (loadError !== null) {
    return (
      <InlineNotice tone="warning" title="Your pitch couldn't load">
        {loadError}
      </InlineNotice>
    );
  }
  if (flow.kind === "LOADING" || company === null) {
    return <Skeleton lines={3} />;
  }

  const busy =
    flow.kind === "PREPARING" ||
    flow.kind === "UPLOADING" ||
    flow.kind === "PROCESSING";
  const current =
    flow.kind === "READY" || flow.kind === "PROCESSING" ? flow.pitch : null;
  const standing = describeNetworkStanding(company, current);

  return (
    <div className="flex flex-col gap-10">
      <PageSection
        id="pitch-status"
        title="The video"
        description="Investors watch this first. Keep it to what you'd say across a table."
      >
        <section className="cq-panel">
          <header className="cq-panel-header">
            <h3 className="cq-title-sm text-(--cq-text-primary)">
              {company.canonicalName}
            </h3>
            <StatusLine flow={flow} />
          </header>
          <div className="cq-panel-body flex flex-col gap-4">
            {flow.kind === "UPLOADING" ? (
              <Progress
                label={`Uploading ${flow.file.name} (${formatBytes(flow.file.sizeBytes)})`}
                value={Math.round(flow.progress * 100)}
              />
            ) : null}
            {flow.kind === "PROCESSING" ? (
              <Progress label="The video service is preparing your pitch" />
            ) : null}
            {flow.kind === "FAILED" ? (
              <InlineNotice tone="warning" title="This pitch didn't make it">
                {flow.message}
              </InlineNotice>
            ) : null}
            {fileNotice !== null ? (
              <InlineNotice tone="info">{fileNotice}</InlineNotice>
            ) : null}
            {flow.kind === "READY" ? (
              <dl className="cq-panel-rows">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="cq-label text-(--cq-text-secondary)">
                    Length
                  </dt>
                  <dd className="cq-body cq-numeric">
                    {formatDuration(flow.pitch.durationSeconds) ??
                      "Not known yet"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="cq-label text-(--cq-text-secondary)">
                    Format
                  </dt>
                  <dd className="cq-body cq-numeric">
                    {flow.pitch.aspectRatio ?? "Not known yet"}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                className="sr-only"
                aria-label="Choose a pitch video"
                onChange={(event) => void onFile(event)}
                disabled={busy}
              />
              <Button
                variant={flow.kind === "READY" ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={ICON_SIZE.regular} aria-hidden="true" />
                {flow.kind === "READY" || flow.kind === "FAILED"
                  ? "Replace pitch"
                  : "Choose a video"}
              </Button>
              <p className="cq-caption text-(--cq-text-tertiary)">
                {guidance === null
                  ? "Portrait works best. Aim for 30 seconds to 2 minutes; 3 minutes at most."
                  : `Portrait (${guidance.preferredAspectRatio}) works best. Aim for ${String(guidance.targetMinSeconds)} seconds to ${String(Math.round(guidance.targetMaxSeconds / 60))} minutes; ${String(Math.round(guidance.hardMaxSeconds / 60))} minutes at most.`}
              </p>
            </div>
          </div>
        </section>
      </PageSection>

      {flow.kind === "READY" ? (
        <PageSection
          id="pitch-preview"
          title="Preview"
          description="What an investor's player will show. Muted until they turn the sound on."
        >
          {preview === null ||
          preview.mediaAssetId !== flow.pitch.mediaAssetId ? (
            <Skeleton lines={2} />
          ) : preview.kind === "UNAVAILABLE" ? (
            <InlineNotice tone="info" title="Preview is not available yet">
              {preview.reason}
            </InlineNotice>
          ) : (
            <div className="mx-auto w-full max-w-(--cq-layout-narrow) overflow-hidden rounded-(--cq-radius-md) bg-(--cq-stage-surface)">
              <PitchPlayer
                company={asDiscovered(company, flow.pitch)}
                policy="ACTIVE"
                authorize={authorize}
                reducedMotion={reducedMotion}
              />
            </div>
          )}
        </PageSection>
      ) : null}

      <PageSection
        id="pitch-standing"
        title="Who sees it"
        description="A pitch reaches investors through the same door as the rest of your profile."
      >
        <p className="cq-status-line">
          {standing.visible ? (
            <Check size={ICON_SIZE.compact} aria-hidden="true" />
          ) : (
            <Eye size={ICON_SIZE.compact} aria-hidden="true" />
          )}
          {standing.sentence}
        </p>
        <p className="mt-3">
          <Link href="/company/visibility" className={buttonClassName("quiet")}>
            Visibility &amp; Discovery
          </Link>
        </p>
      </PageSection>
    </div>
  );
}

/** One quiet line for where the pitch stands, from the record alone. */
function StatusLine({ flow }: { readonly flow: PitchFlowState }) {
  const text = (() => {
    switch (flow.kind) {
      case "LOADING":
        return "Loading";
      case "EMPTY":
        return "No pitch yet";
      case "CREATED":
        return "Ready for a video";
      case "PREPARING":
        return "Preparing the upload";
      case "UPLOADING":
        return `Uploading · ${String(Math.round(flow.progress * 100))}%`;
      case "PROCESSING":
        return "Processing";
      case "READY":
        return "Ready";
      case "FAILED":
        return "Needs a new file";
    }
  })();
  return (
    <span className="cq-status-line" aria-live="polite">
      {flow.kind === "READY" ? (
        <Check size={ICON_SIZE.compact} aria-hidden="true" />
      ) : null}
      {text}
    </span>
  );
}
