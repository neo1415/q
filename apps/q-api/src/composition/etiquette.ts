import type { Logger } from "@capital-q/observability";
import {
  DEFAULT_ETIQUETTE_GUIDES,
  etiquetteExcerpt,
  platformEtiquetteSource,
  type ActivePlatformGuideLike,
  type EtiquetteGuides,
  type EtiquettePurpose,
  type EtiquetteRequest,
} from "@capital-q/q-core";

/**
 * The business etiquette guides in force for one person (ADR 0050): the
 * platform's (the admin's upload, else the built-in guide) and their own.
 *
 * Read server-side for the person Q is writing or speaking for -- the
 * principal of the work, never the counterpart -- and handed to the prompt
 * renderer as fenced reference text. A failure to read never stops Q: it
 * falls back to the built-in guide alone, which is always safe. Short
 * caches keep a busy firing from re-reading the same rows.
 */

export type EtiquetteOwner = {
  readonly tenantId: string;
  readonly userId: string;
  /**
   * Decision 112: the organisation Q works for with this person, when the
   * work is on its behalf; its own guide then sits between the house
   * guide and theirs. Absent: house and personal only, as before.
   */
  readonly organisationId?: string | undefined;
};

export type EtiquetteSource = (
  owner: EtiquetteOwner,
) => Promise<EtiquetteGuides>;

const TTL_MS = 60_000;
const PEOPLE_CACHED = 2_000;

export function createEtiquetteSource(dependencies: {
  readonly platform: () => Promise<ActivePlatformGuideLike>;
  readonly personal: (
    owner: EtiquetteOwner,
  ) => Promise<{ readonly version: number; readonly text: string } | null>;
  /** Decision 112: the organisation's newest guide, or null. */
  readonly organisation?:
    | ((owner: {
        readonly tenantId: string;
        readonly organisationId: string;
      }) => Promise<{ readonly version: number; readonly text: string } | null>)
    | undefined;
  /**
   * Founder brief J3: the person's "what worked" notes (their approvals and
   * edits, kept by the memory Write Gate as their preferences). They join
   * the person's own guide as reference text on style, newest first.
   */
  readonly learned?:
    ((owner: EtiquetteOwner) => Promise<readonly string[]>) | undefined;
  readonly now?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
}): EtiquetteSource {
  const now = dependencies.now ?? (() => Date.now());
  let platform: { at: number; value: EtiquetteGuides["platform"] } | null =
    null;
  const personal = new Map<
    string,
    { at: number; value: EtiquetteGuides["personal"] }
  >();
  const organisations = new Map<
    string,
    { at: number; value: EtiquetteGuides["personal"] }
  >();

  async function organisationGuide(
    owner: EtiquetteOwner,
  ): Promise<EtiquetteGuides["personal"]> {
    const read = dependencies.organisation;
    const organisationId = owner.organisationId;
    if (read === undefined || organisationId === undefined) return null;
    const key = `${owner.tenantId}:${organisationId}`;
    const cached = organisations.get(key);
    if (cached !== undefined && now() - cached.at < TTL_MS) {
      return cached.value;
    }
    const value = await read({ tenantId: owner.tenantId, organisationId })
      .then((guide) =>
        guide === null
          ? null
          : {
              version: `organisation/v${String(guide.version)}`,
              text: guide.text,
            },
      )
      .catch((error: unknown) => {
        dependencies.logger?.warn(
          { err: error },
          "organisation etiquette guide not read; the house and personal guides apply",
        );
        return null;
      });
    if (organisations.size >= PEOPLE_CACHED) organisations.clear();
    organisations.set(key, { at: now(), value });
    return value;
  }

  async function platformGuide(): Promise<EtiquetteGuides["platform"]> {
    if (platform !== null && now() - platform.at < TTL_MS) {
      return platform.value;
    }
    const value = await dependencies
      .platform()
      .then(platformEtiquetteSource)
      .catch((error: unknown) => {
        dependencies.logger?.warn(
          { err: error },
          "platform etiquette guide not read; the built-in guide applies",
        );
        return DEFAULT_ETIQUETTE_GUIDES.platform;
      });
    platform = { at: now(), value };
    return value;
  }

  async function personalGuide(
    owner: EtiquetteOwner,
  ): Promise<EtiquetteGuides["personal"]> {
    const key = `${owner.tenantId}:${owner.userId}`;
    const cached = personal.get(key);
    if (cached !== undefined && now() - cached.at < TTL_MS) {
      return cached.value;
    }
    const [guide, notes] = await Promise.all([
      dependencies
        .personal(owner)
        .then((own) =>
          own === null
            ? null
            : { version: `personal/v${String(own.version)}`, text: own.text },
        )
        .catch((error: unknown) => {
          dependencies.logger?.warn(
            { err: error },
            "personal etiquette guide not read; the house guide alone applies",
          );
          return null;
        }),
      (dependencies.learned?.(owner) ?? Promise.resolve([])).catch(
        (): readonly string[] => [],
      ),
    ]);
    const value = withLearned(guide, notes);
    if (personal.size >= PEOPLE_CACHED) personal.clear();
    personal.set(key, { at: now(), value });
    return value;
  }

  return async (owner) => {
    const [house, ours, own] = await Promise.all([
      platformGuide(),
      organisationGuide(owner),
      personalGuide(owner),
    ]);
    // No organisation guide: exactly the two-guide shape, as before.
    return ours === null
      ? { platform: house, personal: own }
      : { platform: house, organisation: ours, personal: own };
  };
}

/**
 * The person's guide with their "what worked" notes after it, both theirs
 * and both reference text on style. The notes come first in no case: the
 * guide they wrote outranks what Q inferred from their edits.
 */
export function withLearned(
  guide: EtiquetteGuides["personal"],
  notes: readonly string[],
): EtiquetteGuides["personal"] {
  if (notes.length === 0) return guide;
  const learned = `What worked for this person before (their approvals and edits):\n${notes
    .map((note) => `- ${note}`)
    .join("\n")}`;
  return guide === null
    ? { version: `learned/n${String(notes.length)}`, text: learned }
    : {
        version: `${guide.version}+learned/n${String(notes.length)}`,
        // The guide is cut first so the notes still fit the prompt budget.
        text: `${etiquetteExcerpt(guide.text, 800)}\n\n${learned}`,
      };
}

/** The renderer's etiquette input for one call, or none without a source. */
export async function etiquetteFor(
  source: EtiquetteSource | undefined,
  owner: EtiquetteOwner,
  purpose: EtiquettePurpose,
): Promise<EtiquetteRequest | undefined> {
  if (source === undefined) return undefined;
  return { guides: await source(owner), purpose };
}
