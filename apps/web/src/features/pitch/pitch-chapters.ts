import type {
  MediaAssetDto,
  OnboardingSessionView,
  PitchSectionFactDto,
} from "@capital-q/contracts";
import { FOUNDER_PROFILE_SECTIONS } from "@capital-q/founder-onboarding/profile-sections";

/**
 * The main pitch's chapters and "what Q heard" (chosen design 2026-10-21,
 * Pitch option 2, gold). Both come from Q's stored reading of the pitch's
 * own transcript (lane ov: each part of the founder profile with the
 * moment it is said); nothing here is guessed from a clock. A chapter
 * starts where the founder first speaks to that part; a pitch Q has not
 * read has no chapters, and the page says why.
 */

export type Chapter = {
  readonly sectionKey: string;
  readonly label: string;
  readonly start: number;
};

/** The profile's short name for a section ("Traction", "The ask"). */
export function sectionTitle(sectionKey: string, fallback: string): string {
  const section = FOUNDER_PROFILE_SECTIONS.find(
    (candidate) => (candidate.factKey ?? candidate.key) === sectionKey,
  );
  return section?.title ?? fallback;
}

/** "1:34" for a moment in whole seconds. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${String(minutes)}:${secs}`;
}

/** The facts read from one pitch, grouped by section, in pitch order. */
export function sectionsOf(
  facts: readonly PitchSectionFactDto[],
  pitchId: string,
): readonly {
  readonly sectionKey: string;
  readonly label: string;
  readonly at: number;
  readonly facts: readonly {
    readonly label: string;
    readonly value: string;
    readonly at: number;
  }[];
}[] {
  const groups = new Map<
    string,
    {
      label: string;
      at: number;
      facts: { label: string; value: string; at: number }[];
    }
  >();
  for (const fact of facts) {
    if (fact.pitchId !== pitchId) continue;
    const group = groups.get(fact.sectionKey) ?? {
      label: sectionTitle(fact.sectionKey, fact.label),
      at: fact.atSeconds,
      facts: [],
    };
    group.at = Math.min(group.at, fact.atSeconds);
    group.facts.push({
      label: fact.label,
      value: fact.value,
      at: fact.atSeconds,
    });
    groups.set(fact.sectionKey, group);
  }
  return [...groups.entries()]
    .map(([sectionKey, group]) => ({
      sectionKey,
      label: group.label,
      at: group.at,
      facts: [...group.facts].sort((a, b) => a.at - b.at),
    }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Chapters: one per section, at its first moment, within the video's
 * length. Two sections starting at the same second share the first's.
 */
export function chaptersOf(
  facts: readonly PitchSectionFactDto[],
  pitchId: string,
  durationSeconds: number | null,
): readonly Chapter[] {
  const out: Chapter[] = [];
  for (const section of sectionsOf(facts, pitchId)) {
    if (durationSeconds !== null && section.at >= durationSeconds) continue;
    if (out.some((chapter) => chapter.start === section.at)) continue;
    out.push({
      sectionKey: section.sectionKey,
      label: section.label,
      start: section.at,
    });
  }
  return out;
}

/** The chapter playing at a moment: the last one started. */
export function chapterAt(
  chapters: readonly Chapter[],
  seconds: number,
): number {
  let at = 0;
  chapters.forEach((chapter, index) => {
    if (chapter.start <= seconds + 0.25) at = index;
  });
  return at;
}

/** The video the tab leads with: the newest ready one, else the newest. */
export function mainPitch<
  V extends Pick<
    MediaAssetDto,
    "live" | "purpose" | "status" | "createdAt" | "mediaAssetId"
  >,
>(videos: readonly V[]): V | null {
  const live = videos.filter(
    (video) => video.live && video.purpose === "FOUNDER_PITCH",
  );
  const newest = [...live].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return newest.find((video) => video.status === "READY") ?? newest[0] ?? null;
}

/** Why a pitch has no chapters, in words; null when it has some. */
export function noChaptersReason(
  video: Pick<MediaAssetDto, "status" | "transcriptState">,
  read: boolean,
): string {
  if (video.status !== "READY") {
    return "Chapters come once the video is ready and Q has read it.";
  }
  if (
    video.transcriptState === "NOT_REQUESTED" ||
    video.transcriptState === "FAILED"
  ) {
    return "This video has no transcript, so Q can't mark its parts. A new take with clear speech gets chapters.";
  }
  if (!read) {
    return "Q hasn't read this pitch yet. Its chapters appear here once it has.";
  }
  return "Q read this pitch but couldn't tell its parts apart. Saying each part plainly (the problem, traction, the ask) gives it chapters.";
}

export type HeardState =
  | { readonly kind: "PENDING"; readonly suggestionId: string }
  | { readonly kind: "CONFIRMED" }
  | { readonly kind: "SAID" };

/**
 * Where each section Q heard stands with the founder: a proposal from the
 * pitch waiting for their yes (founder onboarding's own suggestion,
 * sourced to the transcript), already in their answers, or simply what
 * they said in the pitch, shown on their profile as their claim.
 */
export function heardState(
  sectionKey: string,
  session: Pick<
    OnboardingSessionView,
    "pendingSuggestions" | "responses"
  > | null,
): HeardState {
  if (session === null) return { kind: "SAID" };
  const pending = session.pendingSuggestions.find(
    (suggestion) =>
      suggestion.status === "PENDING" &&
      suggestion.targetField === sectionKey &&
      suggestion.sourceRefs.some(
        (ref) => ref.sourceType === "PITCH_TRANSCRIPT",
      ),
  );
  if (pending !== undefined) {
    return { kind: "PENDING", suggestionId: pending.id };
  }
  const section = FOUNDER_PROFILE_SECTIONS.find(
    (candidate) => (candidate.factKey ?? candidate.key) === sectionKey,
  );
  const answered = session.responses.some((response) =>
    (section?.stepKeys ?? []).includes(response.stepKey),
  );
  return answered ? { kind: "CONFIRMED" } : { kind: "SAID" };
}
