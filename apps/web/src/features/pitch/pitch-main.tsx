"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PITCH_TITLE_MAX,
  type MediaAssetDto,
  type OnboardingSessionView,
  type PitchSectionFactDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  Check,
  Eye,
  Globe,
  ICON_SIZE,
  Lock,
  Pencil,
  Play,
  Plus,
  Upload,
  UserRound,
  Users,
  Video,
} from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import {
  claimActivePlayer,
  releaseActivePlayer,
} from "@/features/discover/player/active-player";
import { attachHlsOrNativeSource } from "@/features/discover/player/hls-source";
import {
  onboardingCurrentAction,
  onboardingResolveSuggestionAction,
} from "@/features/onboarding-kit/api-actions";
import {
  UnknownMark,
  WorkEmpty,
  WorkSheet,
  WorkTag,
  workButton,
} from "@/features/work/work-b-kit";
import { useT } from "@/features/i18n/language";

import {
  authorisePitchPlaybackAction,
  setPitchDetailsAction,
} from "./pitch-actions";
import {
  chapterAt,
  chaptersOf,
  clock,
  heardState,
  mainPitch,
  noChaptersReason,
  sectionsOf,
  type HeardState,
} from "./pitch-chapters";
import { detailsFor, sharingOf } from "./pitch-details";
import { phaseOf } from "./pitch-library-state";

/**
 * The Pitch tab (chosen design 2026-10-21, option 2, "Main pitch with
 * chapters", gold): the company's main pitch large, its chapters under it
 * (from Q's reading of the transcript, each a jump to that moment), who
 * can watch it in words, the other videos beside, and "What Q heard":
 * each part of the profile Q read from the video, waiting for the
 * founder's confirmation where it is Q's proposal, labelled as their
 * claim, never as verified. Playback is the owner's own signed grant, one
 * player on the page, started only by Play.
 */

type Sharing = ReturnType<typeof sharingOf>;

const SHARING: readonly {
  readonly value: Sharing | "PUBLIC_LINK";
  readonly label: string;
  readonly why: string;
}[] = [
  {
    value: "ORGANISATION",
    label: "Only your team",
    why: "No one outside your company can see it.",
  },
  {
    value: "INVESTORS",
    label: "Investors who can find you",
    why: "Signed-in investors your company is discoverable to.",
  },
  {
    value: "NETWORK",
    label: "Everyone on Capital Q",
    why: "Every signed-in investor and founder on Capital Q. Not on the open web.",
  },
  {
    value: "PUBLIC_LINK",
    label: "Anyone with the link",
    why: "Not offered: a pitch never goes on the open web. Capital Q members and the public are different audiences.",
  },
];

function SharingIcon({ value }: { readonly value: Sharing | "PUBLIC_LINK" }) {
  switch (value) {
    case "ORGANISATION":
      return <Lock aria-hidden="true" />;
    case "INVESTORS":
      return <Users aria-hidden="true" />;
    case "NETWORK":
      return <Eye aria-hidden="true" />;
    case "PUBLIC_LINK":
      return <Globe aria-hidden="true" />;
  }
}

function SharingTag({ video }: { readonly video: MediaAssetDto }) {
  const t = useT();
  const value = sharingOf(video);
  const words = SHARING.find((option) => option.value === value)?.label ?? "";
  return (
    <WorkTag
      tone={value === "ORGANISATION" ? "stone" : "positive"}
      icon={<SharingIcon value={value} />}
    >
      {t(words)}
    </WorkTag>
  );
}

/** Where a video stands, in words. */
export function videoState(video: MediaAssetDto): string {
  switch (phaseOf(video)) {
    case "WAITING":
      return "Waiting for the file";
    case "UPLOADING":
      return "Uploading";
    case "PROCESSING":
      return "Processing";
    case "FAILED":
      return "Needs a new file";
    case "WITHDRAWN":
      return "Deleted";
    case "READY":
      if (video.playbackPolicy === "PRIVATE") return "Private";
      return video.moderationStatus === "ALLOWED" ? "Published" : "In review";
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

function Poster({
  video,
  poster,
  companyName,
  big = false,
}: {
  readonly video: MediaAssetDto;
  readonly poster: string | null;
  readonly companyName: string | null;
  readonly big?: boolean;
}) {
  const t = useT();
  const ready = video.status === "READY";
  return (
    <span
      className={cx(
        "cq-cinema relative flex aspect-video w-full flex-none flex-col justify-end overflow-hidden bg-(--cq-stage-canvas) text-(--cq-stage-text)",
        big
          ? "rounded-(--cq-radius-lg) px-4 py-3.5"
          : "rounded-(--cq-radius-md) px-2 py-1.5",
      )}
    >
      {poster === null ? null : (
        // A signed poster straight from the video service (doc 20).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading={big ? "eager" : "lazy"}
          decoding="async"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_top,var(--cq-stage-canvas)_0%,transparent_60%)]"
      />
      <span
        aria-hidden="true"
        className={cx(
          "absolute start-1/2 top-[42%] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--cq-stage-text) text-(--cq-stage-canvas) rtl:translate-x-1/2",
          big ? "size-16" : "top-1/2 size-[30px]",
        )}
      >
        {ready ? (
          <Play
            size={big ? 22 : 12}
            className="ms-0.5 fill-current"
            aria-hidden="true"
          />
        ) : (
          <Video size={big ? 22 : 12} aria-hidden="true" />
        )}
      </span>
      {video.durationSeconds === null || !big ? null : (
        <span className="absolute end-3 top-2.5 rounded-full bg-(--cq-stage-veil) px-2 py-0.5 text-xs tabular-nums">
          {clock(video.durationSeconds)}
        </span>
      )}
      {big ? (
        <span className="relative flex flex-col">
          <span className="text-[24px] font-semibold tracking-[-0.01em]">
            {video.title ?? t("Pitch")}
          </span>
          <span className="text-xs text-(--cq-stage-text-muted)">
            {ready ? (companyName ?? "") : t(videoState(video))}
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function PitchMain({
  companyId,
  companyName,
  videos: initialVideos,
  sections,
}: {
  readonly companyId: string;
  readonly companyName: string | null;
  readonly videos: readonly MediaAssetDto[];
  /** Q's reading of this company's pitches; null when it couldn't load. */
  readonly sections: readonly PitchSectionFactDto[] | null;
}) {
  const t = useT();
  const [videos, setVideos] = useState(initialVideos);
  const main = mainPitch(videos);
  const others = videos.filter(
    (video) =>
      video.live &&
      video.purpose === "FOUNDER_PITCH" &&
      video.mediaAssetId !== main?.mediaAssetId,
  );

  const [posters, setPosters] = useState<Readonly<Record<string, string>>>({});
  const [grantUrl, setGrantUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekTo = useRef<number | null>(null);

  const readyIds = videos
    .filter((video) => video.live && video.status === "READY")
    .slice(0, 8)
    .map((video) => video.mediaAssetId)
    .join(",");
  useEffect(() => {
    if (readyIds === "") return;
    let cancelled = false;
    for (const id of readyIds.split(",")) {
      void authorisePitchPlaybackAction(companyId, id).then((result) => {
        if (cancelled || !result.ok) return;
        if (result.value.posterUrl !== null) {
          const url = result.value.posterUrl;
          setPosters((known) => ({ ...known, [id]: url }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [companyId, readyIds]);

  const chapters =
    main === null || sections === null
      ? []
      : chaptersOf(sections, main.mediaAssetId, main.durationSeconds);
  const heard =
    main === null || sections === null
      ? []
      : sectionsOf(sections, main.mediaAssetId);
  const current = playing ? chapterAt(chapters, now) : (picked ?? 0);

  // The one player: attached on Play, detached when the page leaves.
  const mainId = main?.mediaAssetId ?? null;
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || grantUrl === null || mainId === null) return;
    const detach = attachHlsOrNativeSource(video, grantUrl, mainId);
    const onReady = () => {
      if (seekTo.current !== null) {
        video.currentTime = seekTo.current;
        seekTo.current = null;
      }
      void video.play().catch(() => undefined);
    };
    const onPlay = () => claimActivePlayer(video);
    const onTime = () => setNow(video.currentTime);
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTime);
      video.pause();
      releaseActivePlayer(video);
      detach();
    };
  }, [grantUrl, mainId]);

  const play = useCallback(
    (at?: number) => {
      if (main === null || main.status !== "READY") return;
      if (at !== undefined) seekTo.current = at;
      const video = videoRef.current;
      if (playing && video !== null) {
        if (at !== undefined) {
          video.currentTime = at;
          seekTo.current = null;
        }
        void video.play().catch(() => undefined);
        return;
      }
      setPlayError(null);
      void authorisePitchPlaybackAction(companyId, main.mediaAssetId).then(
        (result) => {
          if (!result.ok) {
            setPlayError(result.message);
            return;
          }
          setPlaying(true);
          setGrantUrl(result.value.playbackUrl);
        },
      );
    },
    [companyId, main, playing],
  );

  // What Q heard: the founder's own onboarding proposals from the pitch.
  const [session, setSession] = useState<OnboardingSessionView | null>(null);
  const [heardBusy, setHeardBusy] = useState<string | null>(null);
  const [heardError, setHeardError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixText, setFixText] = useState("");
  useEffect(() => {
    let cancelled = false;
    void onboardingCurrentAction("founder").then((result) => {
      if (!cancelled && result.ok) setSession(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = (
    sectionKey: string,
    state: HeardState,
    resolution: "ACCEPT" | "EDIT",
  ) => {
    if (state.kind !== "PENDING" || session === null) return;
    setHeardBusy(sectionKey);
    setHeardError(null);
    void onboardingResolveSuggestionAction({
      sessionId: session.session.id,
      suggestionId: state.suggestionId,
      resolution,
      ...(resolution === "EDIT"
        ? { response: { type: "TEXT", text: fixText.trim() } }
        : {}),
      expectedSessionVersion: session.session.version,
      idempotencyKey: newKey(),
    }).then((result) => {
      setHeardBusy(null);
      if (!result.ok) {
        setHeardError(result.message);
        return;
      }
      setSession(result.value);
      setFixing(null);
    });
  };

  // Who can watch: one video's name and audience, saved together.
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const sheetVideo =
    videos.find((video) => video.mediaAssetId === sheetFor) ?? null;
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<Sharing>("INVESTORS");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const openSheet = (video: MediaAssetDto) => {
    setSheetFor(video.mediaAssetId);
    setName(video.title ?? "");
    setSharing(sharingOf(video));
    setSaving("idle");
    setSaveError(null);
  };
  const save = () => {
    if (sheetVideo === null) return;
    setSaving("saving");
    setSaveError(null);
    void setPitchDetailsAction(
      companyId,
      sheetVideo.mediaAssetId,
      {
        title: name.trim().length === 0 ? null : name.trim(),
        ...detailsFor(sharing, sheetVideo.audience),
      },
      sheetVideo.version,
    ).then((result) => {
      if (!result.ok) {
        setSaving("idle");
        setSaveError(result.message);
        return;
      }
      setVideos((list) =>
        list.map((video) =>
          video.mediaAssetId === result.value.mediaAssetId
            ? result.value
            : video,
        ),
      );
      setSaving("saved");
    });
  };

  if (main === null) {
    return (
      <WorkEmpty
        title={t("No pitch video yet")}
        icon={<Video size={ICON_SIZE.prominent} aria-hidden="true" />}
        action={
          <Link href="/pitch/new" className={workButton("gold")} data-pitch-new>
            <Upload size={ICON_SIZE.compact} aria-hidden="true" />
            {t("Upload a video")}
          </Link>
        }
        data-pitch-empty
      >
        {t(
          "Upload a recording you already have, even a rough one. Q reads it first and tells you what investors will hear.",
        )}
      </WorkEmpty>
    );
  }

  return (
    <div
      className="grid max-w-[1240px] items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      data-pitch-main={main.mediaAssetId}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-col gap-2.5">
          {playing ? (
            <video
              ref={videoRef}
              controls
              playsInline
              poster={posters[main.mediaAssetId]}
              aria-label={t(`${main.title ?? "Pitch"}, playing`)}
              className="cq-cinema aspect-video w-full rounded-(--cq-radius-lg) bg-(--cq-stage-canvas)"
              data-pitch-player
            />
          ) : (
            <button
              type="button"
              onClick={() => play()}
              disabled={main.status !== "READY"}
              aria-label={
                main.status === "READY"
                  ? t(`Play ${main.title ?? "your pitch"}`)
                  : t(videoState(main))
              }
              className="block w-full rounded-(--cq-radius-lg) text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:cursor-default"
            >
              <Poster
                video={main}
                poster={posters[main.mediaAssetId] ?? null}
                companyName={companyName}
                big
              />
            </button>
          )}
          {playError === null ? null : (
            <p role="alert" className="m-0 text-sm text-(--cq-text-secondary)">
              {t(playError)}
            </p>
          )}
          {chapters.length === 0 ? (
            <p
              className="m-0 flex items-start gap-2 rounded-(--cq-radius-md) border border-dashed border-(--cq-border) px-3 py-2.5 text-[13px] text-(--cq-text-secondary)"
              data-chapters-empty
            >
              <UnknownMark />
              <span>
                <b className="text-(--cq-text-primary)">
                  {t("No chapters yet.")}
                </b>{" "}
                {t(noChaptersReason(main, heard.length > 0))}
              </span>
            </p>
          ) : (
            <ol
              className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-4"
              aria-label={t("Chapters")}
            >
              {chapters.map((chapter, index) => (
                <li key={chapter.sectionKey}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(index);
                      play(chapter.start);
                    }}
                    disabled={main.status !== "READY"}
                    aria-current={index === current ? "step" : undefined}
                    className={cx(
                      "flex min-h-12 w-full flex-col gap-0.5 rounded-(--cq-radius-md) border-t-[3px] px-2.5 py-2 text-start text-[13px] font-medium text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                      index === current
                        ? "border-(--cq-accent) bg-(--cq-accent-soft)"
                        : "border-(--cq-border-subtle) bg-(--cq-surface-raised) hover:bg-(--cq-surface-subtle)",
                    )}
                    data-chapter={chapter.start}
                  >
                    <span className="text-xs font-normal text-(--cq-text-tertiary) tabular-nums">
                      {clock(chapter.start)}
                    </span>
                    {t(chapter.label)}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 flex-1 text-[15px] text-(--cq-text-primary)">
            {main.title ?? t("Pitch")}
            {main.durationSeconds === null
              ? ""
              : `, ${clock(main.durationSeconds)}`}
          </b>
          <SharingTag video={main} />
          <button
            type="button"
            onClick={() => openSheet(main)}
            className={workButton("secondary", undefined, "small")}
            data-who-can-watch
          >
            {t("Who can watch")}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {others.map((video) => (
            <button
              key={video.mediaAssetId}
              type="button"
              onClick={() => openSheet(video)}
              className="cq-crm-press grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-2 text-start hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              data-pitch-other={video.mediaAssetId}
            >
              <Poster
                video={video}
                poster={posters[video.mediaAssetId] ?? null}
                companyName={null}
              />
              <span className="flex min-w-0 flex-col">
                <b className="truncate text-sm text-(--cq-text-primary)">
                  {video.title ?? t("Pitch")}
                </b>
                <span className="text-xs text-(--cq-text-tertiary)">
                  {t(
                    `${videoState(video)}, ${
                      SHARING.find(
                        (option) => option.value === sharingOf(video),
                      )?.label ?? ""
                    }`,
                  )}
                </span>
              </span>
            </button>
          ))}
          <Link
            href="/pitch/new"
            className="cq-crm-press flex min-h-[84px] items-center justify-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) p-2 text-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            data-pitch-new
          >
            <Plus size={ICON_SIZE.compact} aria-hidden="true" />
            {t("New video")}
          </Link>
        </div>
      </div>

      <aside
        className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4 lg:sticky lg:top-4"
        aria-labelledby="pitch-heard"
        data-pitch-heard
      >
        <h3
          id="pitch-heard"
          className="m-0 text-base font-semibold text-(--cq-text-primary)"
        >
          {t("What Q heard in your pitch")}
        </h3>
        <p className="m-0 text-xs text-(--cq-text-tertiary)">
          {t(
            "Q’s reading of your video. Confirm each before it counts as your answer; until then it shows as said in your pitch.",
          )}
        </p>
        {sections === null ? (
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {t("Q’s reading couldn’t load just now.")}
          </p>
        ) : heard.length === 0 ? (
          <p className="m-0 border-t border-(--cq-border-subtle) pt-2.5 text-sm text-(--cq-text-secondary)">
            {t(noChaptersReason(main, false))}
          </p>
        ) : (
          heard.map((section) => {
            const state = heardState(section.sectionKey, session);
            const busy = heardBusy === section.sectionKey;
            return (
              <div
                key={section.sectionKey}
                className="flex flex-wrap items-center gap-2 border-t border-(--cq-border-subtle) pt-2.5"
                data-heard={section.sectionKey}
                data-heard-state={state.kind}
              >
                <div className="flex min-w-0 flex-1 basis-[60%] flex-col gap-px">
                  <span className="text-xs text-(--cq-text-tertiary)">
                    {t(`${section.label}, at ${clock(section.at)}`)}
                  </span>
                  {fixing === section.sectionKey ? (
                    <textarea
                      value={fixText}
                      onChange={(event) => setFixText(event.target.value)}
                      rows={3}
                      aria-label={t(`Your words for ${section.label}`)}
                      className="mt-1 w-full rounded-(--cq-radius-xs) border border-(--cq-border) bg-(--cq-surface-raised) p-1.5 text-[15px] text-(--cq-text-primary) outline-2 outline-offset-2 outline-(--cq-accent)"
                    />
                  ) : (
                    section.facts.map((fact) => (
                      <b
                        key={`${fact.label}-${String(fact.at)}`}
                        className="text-[15px] font-medium text-(--cq-text-primary)"
                      >
                        {fact.value}
                      </b>
                    ))
                  )}
                </div>
                {state.kind === "PENDING" ? (
                  fixing === section.sectionKey ? (
                    <>
                      <button
                        type="button"
                        disabled={busy || fixText.trim().length === 0}
                        onClick={() =>
                          resolve(section.sectionKey, state, "EDIT")
                        }
                        className={workButton("gold", undefined, "small")}
                      >
                        {t("Save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFixing(null)}
                        className={workButton("quiet", undefined, "small")}
                      >
                        {t("Cancel")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          resolve(section.sectionKey, state, "ACCEPT")
                        }
                        className={workButton("gold", undefined, "small")}
                        data-heard-confirm
                      >
                        {t("Confirm")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setFixing(section.sectionKey);
                          setFixText(
                            section.facts
                              .map((fact) => `${fact.label}: ${fact.value}`)
                              .join("\n"),
                          );
                        }}
                        className={workButton("quiet", undefined, "small")}
                        data-heard-fix
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {t("Fix")}
                      </button>
                    </>
                  )
                ) : (
                  <WorkTag tone="brass" icon={<UserRound aria-hidden="true" />}>
                    {state.kind === "CONFIRMED"
                      ? t("Your claim, confirmed")
                      : t("Your claim, said in the pitch")}
                  </WorkTag>
                )}
              </div>
            );
          })
        )}
        {heardError === null ? null : (
          <p role="alert" className="m-0 text-sm text-(--cq-text-secondary)">
            {t(heardError)}
          </p>
        )}
      </aside>

      <WorkSheet
        open={sheetVideo !== null}
        onOpenChange={(next) => {
          if (!next) setSheetFor(null);
        }}
        tone="gold"
        title={sheetVideo === null ? "" : (sheetVideo.title ?? t("Pitch"))}
        sub={
          sheetVideo === null
            ? undefined
            : t(
                `${videoState(sheetVideo)}, uploaded ${formatDay(sheetVideo.createdAt)}`,
              )
        }
        footer={
          sheetVideo === null ? null : (
            <>
              <button
                type="button"
                onClick={save}
                disabled={saving === "saving"}
                aria-busy={saving === "saving"}
                className={workButton("gold")}
                data-pitch-save
              >
                {saving === "saved" ? (
                  <>
                    <Check size={ICON_SIZE.compact} aria-hidden="true" />
                    {t("Saved")}
                  </>
                ) : saving === "saving" ? (
                  t("Saving…")
                ) : (
                  t("Save")
                )}
              </button>
              <Link
                href={`/pitch/${sheetVideo.mediaAssetId}`}
                className={workButton("secondary")}
              >
                {t("Replace, preview or delete")}
              </Link>
            </>
          )
        }
        data-pitch-sheet
      >
        {sheetVideo === null ? null : (
          <>
            <Poster
              video={sheetVideo}
              poster={posters[sheetVideo.mediaAssetId] ?? null}
              companyName={companyName}
              big
            />
            <label className="flex flex-col gap-1.5 text-xs text-(--cq-text-tertiary)">
              {t("Name")}
              <input
                value={name}
                maxLength={PITCH_TITLE_MAX}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaving("idle");
                }}
                className="min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-[15px] text-(--cq-text-primary)"
              />
            </label>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Who can watch")}
            </span>
            <div
              role="radiogroup"
              aria-label={t("Who can watch")}
              className="flex flex-col gap-1.5"
            >
              {SHARING.map((option) => {
                const offered = option.value !== "PUBLIC_LINK";
                const on = option.value === sharing;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={!offered}
                    disabled={!offered}
                    onClick={() => {
                      if (option.value !== "PUBLIC_LINK") {
                        setSharing(option.value);
                        setSaving("idle");
                      }
                    }}
                    className={cx(
                      "flex min-h-14 items-center gap-3 rounded-(--cq-radius-lg) border px-3.5 py-3 text-start transition-colors duration-(--cq-motion-fast) [&>svg]:size-[18px] [&>svg]:flex-none",
                      on
                        ? "border-(--cq-accent) bg-(--cq-accent-soft)"
                        : "border-(--cq-border-subtle) hover:border-(--cq-border)",
                      !offered && "opacity-60",
                    )}
                    data-sharing={option.value}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "size-[18px] flex-none rounded-full border-2",
                        on
                          ? "border-(--cq-accent) shadow-[inset_0_0_0_4px_var(--cq-surface-raised),inset_0_0_0_10px_var(--cq-accent)]"
                          : "border-(--cq-border)",
                      )}
                    />
                    <SharingIcon value={option.value} />
                    <span className="flex min-w-0 flex-col">
                      <b className="text-sm text-(--cq-text-primary)">
                        {t(option.label)}
                      </b>
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t(option.why)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="m-0 flex items-center gap-1.5 text-xs text-(--cq-text-tertiary)">
              <Lock size={14} aria-hidden="true" />
              {t("You can change this at any time.")}
            </p>
            {saveError === null ? null : (
              <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
                {t(saveError)}
              </p>
            )}
            {saving !== "saved" ? null : (
              <p
                role="status"
                className="cq-crm-swap m-0 rounded-(--cq-radius-md) bg-(--cq-positive-soft) px-3 py-2.5 text-sm text-(--cq-positive)"
              >
                {t(
                  `Saved. Who can watch: ${
                    SHARING.find((option) => option.value === sharing)?.label ??
                    ""
                  }.`,
                )}
              </p>
            )}
          </>
        )}
      </WorkSheet>
    </div>
  );
}
