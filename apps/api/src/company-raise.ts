import {
  composeCompanyRaiseReader,
  type CompanyRaiseContextPorts,
  type CompanyRaiseReader,
} from "@capital-q/discovery";
import {
  firstPitchRaise,
  MediaAssetIdSchema,
  type TimedCue,
} from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

/**
 * The API's composition of `raiseFor` (R2): Discover's card and the
 * company profile both read the raise from this one reader, so the same
 * reader is told the same thing on both (and Q, composed the same way in
 * the Q API). Media's transcript is read under its playback rule; the
 * raise said in it is Media's own `firstPitchRaise`.
 */
export function createApiCompanyRaiseReader(
  ports: Omit<CompanyRaiseContextPorts, "pitchRaise"> & {
    /** The pitch's transcript cues under the playback rule, or null. */
    readonly pitchCues: (
      actor: ActorContext,
      companyId: string,
      mediaAssetId: string,
    ) => Promise<readonly TimedCue[] | null>;
  },
): CompanyRaiseReader {
  return composeCompanyRaiseReader({
    ...ports,
    pitchRaise: async (actor, companyId, mediaAssetId) => {
      if (!MediaAssetIdSchema.safeParse(mediaAssetId).success) return null;
      const cues = await ports.pitchCues(actor, companyId, mediaAssetId);
      return cues === null ? null : firstPitchRaise(cues);
    },
  });
}
