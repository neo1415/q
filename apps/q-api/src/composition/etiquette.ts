import type { Logger } from "@capital-q/observability";
import {
  DEFAULT_ETIQUETTE_GUIDES,
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
    const value = await dependencies
      .personal(owner)
      .then((guide) =>
        guide === null
          ? null
          : { version: `personal/v${String(guide.version)}`, text: guide.text },
      )
      .catch((error: unknown) => {
        dependencies.logger?.warn(
          { err: error },
          "personal etiquette guide not read; the house guide alone applies",
        );
        return null;
      });
    if (personal.size >= PEOPLE_CACHED) personal.clear();
    personal.set(key, { at: now(), value });
    return value;
  }

  return async (owner) => {
    const [house, own] = await Promise.all([
      platformGuide(),
      personalGuide(owner),
    ]);
    return { platform: house, personal: own };
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
