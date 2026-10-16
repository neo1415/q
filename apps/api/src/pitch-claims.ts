import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type {
  CompanyProfileViewer,
  Money,
  PitchClaimDto,
  PitchRaiseNotice,
  PitchSectionFactDto,
  PitchSummaryDto,
} from "@capital-q/contracts";
import { PitchSectionFactDtoSchema } from "@capital-q/contracts";
import { decodeJsonbString, type DatabaseExecutor } from "@capital-q/database";
import { extractPitchClaims, type TimedCue } from "@capital-q/media";
import type { DisclosurePolicyRepository } from "@capital-q/permissions";

/**
 * What a company's pitches say, on its profile (founder, 2026-10-08: "they
 * literally say it in the video ... the overview says it's not shared").
 *
 * The transcript is part of the pitch (R18): the cues are read through the
 * media context's own playback rule for this reader, so a claim reaches
 * exactly the people who may play the pitch it was said in. Each claim is
 * the company's own (USER_CLAIM, SELF_REPORTED) with the pitch and moment
 * as provenance; nothing here verifies or stores anything.
 *
 * Disclosure precedence for the raise, in order:
 *   1. a declared raise disclosed to this reader is the raise; a pitch that
 *      says a different figure stays beside it (contradictions coexist);
 *   2. a founder who turned a raise share OFF chose to hide it: the
 *      overview shows no raise from a pitch either, and the founder is
 *      told their video still says it (never leaked on their behalf);
 *   3. otherwise the raise as said in the pitch, labelled as said there.
 */

/** How the founder has set the current raise's sharing. */
export type RaiseSharing = "NETWORK" | "PRIVATE" | "HIDDEN";

/** Videos read per profile: the newest first, bounded for latency. */
export const PITCH_CLAIM_VIDEOS_MAX = 6;

export async function pitchClaimsFor(
  videos: readonly PitchSummaryDto[],
  cuesOf: (mediaAssetId: string) => Promise<readonly TimedCue[] | null>,
): Promise<PitchClaimDto[]> {
  const read = await Promise.all(
    videos.slice(0, PITCH_CLAIM_VIDEOS_MAX).map(async (video) => ({
      video,
      cues: await cuesOf(video.mediaAssetId).catch(() => null),
    })),
  );
  return read
    .flatMap(({ video, cues }) =>
      cues === null
        ? []
        : extractPitchClaims(cues).map((claim) => ({
            kind: claim.kind,
            statement: claim.statement.slice(0, 300),
            pitchId: video.mediaAssetId,
            pitchTitle: video.title ?? null,
            atSeconds: Math.floor(claim.atMs / 1000),
            money: claim.money ?? null,
            stageCode: claim.stageCode ?? null,
            instrument: claim.instrument ?? null,
            truthClass: "USER_CLAIM" as const,
            evidenceStatus: "SELF_REPORTED" as const,
            source: "PITCH_VIDEO" as const,
          })),
    )
    .slice(0, 40);
}

/** One stored section of a pitch's reading, as the worker wrote it. */
export type StoredPitchSection = {
  readonly key: string;
  readonly facts: readonly {
    readonly label: string;
    readonly value: string;
    readonly atSeconds: number;
  }[];
};

/**
 * Lane ov 2026-10-16: what the pitches this reader may play say, section
 * by section, from Q's stored reading of each transcript (no model runs
 * here). `readingOf` authorises each pitch with the player's own rule and
 * returns null where this reader may not play it, or it was not read yet.
 * Every fact is the founder's own claim with its moment; anything the
 * stored row holds that does not fit the contract is dropped, never shown.
 */
export async function pitchSectionsFor(
  videos: readonly PitchSummaryDto[],
  readingOf: (
    mediaAssetId: string,
  ) => Promise<readonly StoredPitchSection[] | null>,
): Promise<PitchSectionFactDto[]> {
  const read = await Promise.all(
    videos.slice(0, PITCH_CLAIM_VIDEOS_MAX).map(async (video) => ({
      video,
      sections: await readingOf(video.mediaAssetId).catch(() => null),
    })),
  );
  const out: PitchSectionFactDto[] = [];
  for (const { video, sections } of read) {
    for (const section of sections ?? []) {
      for (const fact of section.facts) {
        const parsed = PitchSectionFactDtoSchema.safeParse({
          sectionKey: section.key,
          label: fact.label,
          value: fact.value,
          pitchId: video.mediaAssetId,
          pitchTitle: video.title ?? null,
          atSeconds: fact.atSeconds,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          source: "PITCH_VIDEO",
        });
        if (parsed.success) out.push(parsed.data);
      }
    }
  }
  return out.slice(0, 160);
}

/**
 * The newest stored reading of one pitch (media.pitch_section_readings).
 * The caller has already authorised the pitch for the reader; this is the
 * server's own read of a server-only table. Malformed entries are dropped.
 */
export async function storedPitchSections(
  sql: DatabaseExecutor,
  mediaAssetId: string,
): Promise<readonly StoredPitchSection[] | null> {
  const rows = await sql<{ sections: unknown }[]>`
    select sections from media.pitch_section_readings
     where media_asset_id = ${mediaAssetId}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  if (row === undefined) return null;
  const raw = decodeJsonbString(row.sections);
  if (!Array.isArray(raw)) return null;
  const out: StoredPitchSection[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, facts } = entry as { key?: unknown; facts?: unknown };
    if (typeof key !== "string" || !Array.isArray(facts)) continue;
    out.push({
      key,
      facts: (facts as unknown[]).flatMap((fact) => {
        if (typeof fact !== "object" || fact === null) return [];
        const { label, value, atSeconds } = fact as Record<string, unknown>;
        return typeof label === "string" &&
          typeof value === "string" &&
          typeof atSeconds === "number"
          ? [{ label, value, atSeconds }]
          : [];
      }),
    });
  }
  return out;
}

function normalised(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const rest = fraction.replace(/0+$/, "");
  const integer = whole.replace(/^0+(?=\d)/, "");
  return rest === "" ? integer : `${integer}.${rest}`;
}

export function sameMoney(a: Money, b: Money): boolean {
  return (
    a.currency.toUpperCase() === b.currency.toUpperCase() &&
    normalised(a.amount) === normalised(b.amount)
  );
}

/** The raise kinds a hidden raise also hides: they quote the raise sentence. */
const RAISE_KINDS: ReadonlySet<PitchClaimDto["kind"]> = new Set([
  "RAISE",
  "STAGE",
  "INSTRUMENT",
]);

export function presentPitchRaise(input: {
  readonly viewer: CompanyProfileViewer;
  /** The declared raise as disclosed to this reader (the owner: their own). */
  readonly raise: Money | null;
  readonly claims: readonly PitchClaimDto[];
  readonly sharing: RaiseSharing;
}): {
  readonly pitchClaims: PitchClaimDto[];
  readonly raiseFromPitch: PitchClaimDto | null;
  readonly pitchRaiseNotice: PitchRaiseNotice | null;
} {
  const said = input.claims.find((claim) => claim.kind === "RAISE") ?? null;
  const hidden = input.sharing === "HIDDEN";
  const owner = input.viewer === "OWNER";
  // A hidden raise is hidden from the overview for everyone but the owner.
  const pitchClaims =
    hidden && !owner
      ? input.claims.filter((claim) => !RAISE_KINDS.has(claim.kind))
      : [...input.claims];
  const raiseFromPitch =
    said === null || hidden || input.raise !== null ? null : said;
  let pitchRaiseNotice: PitchRaiseNotice | null = null;
  if (owner && said !== null && said.money !== null) {
    if (hidden) {
      pitchRaiseNotice = { state: "HIDDEN_BY_FOUNDER", said };
    } else if (input.raise !== null && !sameMoney(input.raise, said.money)) {
      pitchRaiseNotice = { state: "DIFFERS_FROM_DECLARED", said };
    } else if (input.sharing !== "NETWORK") {
      pitchRaiseNotice = { state: "SHOWN_FROM_PITCH", said };
    }
  }
  return { pitchClaims, raiseFromPitch, pitchRaiseNotice };
}

/**
 * The current raise's sharing, from the disclosure policies' own history:
 * an unrevoked network share is NETWORK; any share the founder revoked is
 * HIDDEN (they took it back, so privacy wins); otherwise PRIVATE, the
 * default nobody chose against. Read under the platform's authority for
 * the route that already decided this reader may see the company; it
 * returns a word, never the figure.
 */
export function createRaiseSharing(ports: {
  readonly sql: DatabaseExecutor;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany">;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly policies: Pick<DisclosurePolicyRepository, "findAllForResource">;
}): (companyId: string) => Promise<RaiseSharing> {
  return async (companyId) => {
    const id = CompanyIdSchema.safeParse(companyId);
    if (!id.success) return "PRIVATE";
    const company = await ports.companies.findCanonicalCompany(id.data);
    if (company === null) return "PRIVATE";
    const objective = await ports.capital.getCurrentForCompany(
      company.tenantId,
      company.id,
    );
    if (objective === null) return "PRIVATE";
    const policies = await ports.policies.findAllForResource(ports.sql, {
      type: "capital_objective",
      id: objective.id,
    });
    if (
      policies.some(
        (p) => p.revokedAt === null && p.scopeType === "network_visible",
      )
    ) {
      return "NETWORK";
    }
    return policies.some((p) => p.revokedAt !== null) ? "HIDDEN" : "PRIVATE";
  };
}
