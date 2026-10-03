import { z } from "zod";

import {
  OwnerPlaybackPolicySchema,
  PITCH_TITLE_MAX,
  PitchAudienceSchema,
  ResourceVersionSchema,
  SetPitchDetailsResponseSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  MediaAssetIdSchema,
  toMediaAssetDto,
  type MediaAsset,
} from "@capital-q/media";

import { defineAppAction, type AppActionContext } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * A pitch's title and who can watch it (live 2026-10-02, Nixo: "Let
 * investors play my pitch video" met "no record"; the screen had two
 * controls that could disagree). One action: the audience and playback
 * change together in one service call. For the person on the screen it is
 * their own click; for Q it is CONSEQUENTIAL (it widens disclosure), so Q
 * prepares it and the person approves exactly it.
 */

export const PITCH_SHARING = ["ORGANISATION", "INVESTORS", "NETWORK"] as const;
export const PitchSharingSchema = z.enum(PITCH_SHARING);
export type PitchSharing = z.infer<typeof PitchSharingSchema>;

export const PitchDetailsInputSchema = z
  .object({
    companyId: UuidSchema,
    mediaAssetId: UuidSchema,
    /** Undefined keeps it; null or blank clears it. */
    title: z.string().max(PITCH_TITLE_MAX).nullable().optional(),
    audience: PitchAudienceSchema.optional(),
    playbackPolicy: OwnerPlaybackPolicySchema.optional(),
    /** The version the screen saw; Q acts on the current one. */
    expectedVersion: ResourceVersionSchema.optional(),
  })
  .strict();
export type PitchDetailsInput = z.infer<typeof PitchDetailsInputSchema>;

const SHARING_WORDS: Readonly<Record<PitchSharing, string>> = {
  ORGANISATION: "only your organisation",
  INVESTORS: "investors who can find your company",
  NETWORK: "everyone on Capital Q",
};

/** The one choice a record stands at. */
export function sharingOf(asset: {
  readonly playbackPolicy: string;
  readonly audience: "INVESTORS" | "NETWORK";
}): PitchSharing {
  return asset.playbackPolicy === "PRIVATE" ? "ORGANISATION" : asset.audience;
}

function sharingOfInput(input: PitchDetailsInput): PitchSharing | null {
  if (input.playbackPolicy === "PRIVATE") return "ORGANISATION";
  if (input.playbackPolicy === "AUTHORISED") return input.audience ?? null;
  return null;
}

async function ownPitch(
  ports: AppActionPorts,
  context: AppActionContext,
  companyId: string,
  mediaAssetId: string,
): Promise<MediaAsset | null> {
  if (ports.media === undefined) return null;
  const assets = await ports.media
    .listCompanyMedia({ actor: context.actor, companyId })
    .catch(() => null);
  return (
    assets?.find(
      (asset) =>
        asset.id === mediaAssetId &&
        asset.purpose === "FOUNDER_PITCH" &&
        asset.status !== "DELETED",
    ) ?? null
  );
}

const ToolInputSchema = z
  .object({
    pitch: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        'Which of their pitch videos: its title as they said it, or "my pitch" when they have one.',
      ),
    sharing: PitchSharingSchema.optional().describe(
      "Who can watch it: ORGANISATION (only their organisation), INVESTORS (investors who can find the company) or NETWORK (also every founder on Capital Q). 'Let investors play it' is INVESTORS unless they said everyone.",
    ),
    title: z
      .string()
      .trim()
      .max(PITCH_TITLE_MAX)
      .optional()
      .describe("A new title, only when they asked to rename it."),
  })
  .strict()
  .refine((input) => input.sharing !== undefined || input.title !== undefined, {
    message: "say who can watch it, or a new title",
  });

export const SET_PITCH_SHARING = defineAppAction<
  PitchDetailsInput,
  MediaAsset,
  z.infer<typeof ToolInputSchema>
>({
  name: "pitch.details.set",
  supersedes: true,
  short: "set who sees a pitch",
  area: "pitch",
  classification: "CONSEQUENTIAL",
  does: "Sets a pitch video's title and who can watch it (only their organisation, investors, or everyone on Capital Q), audience and playback together.",
  input: PitchDetailsInputSchema,
  output: z.custom<MediaAsset>(),
  authorize: async (ports, context, input) =>
    (await ownPitch(ports, context, input.companyId, input.mediaAssetId)) ===
    null
      ? { ok: false, reason: "That pitch isn't one of your company's videos." }
      : { ok: true },
  run: async (ports, context, input) => {
    const media = ports.media;
    const asset = await ownPitch(
      ports,
      context,
      input.companyId,
      input.mediaAssetId,
    );
    if (media === undefined || asset === null) {
      throw new Error("PITCH_NOT_AVAILABLE");
    }
    return media.setPitchDetails({
      actor: context.actor,
      companyId: input.companyId,
      mediaAssetId: MediaAssetIdSchema.parse(input.mediaAssetId),
      details: {
        title: input.title === undefined ? asset.title : input.title,
        audience: input.audience ?? asset.audience,
        ...(input.playbackPolicy === undefined
          ? {}
          : { playbackPolicy: input.playbackPolicy }),
      },
      // The screen decides on the version it saw; Q on the current one,
      // read inside the same authorization.
      expectedVersion: input.expectedVersion ?? asset.version,
      correlationId: context.correlationId,
    });
  },
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: (input) => {
    const sharing = sharingOfInput(input);
    const what =
      sharing === null
        ? input.title === undefined || input.title === null
          ? "Update your pitch video"
          : `Rename your pitch video to "${input.title}"`
        : `Let ${SHARING_WORDS[sharing]} watch your pitch video`;
    return {
      summary: what,
      preview:
        sharing === "ORGANISATION"
          ? "Only people in your organisation will be able to play it."
          : sharing === null
            ? "Only the title changes."
            : `Once approved, ${SHARING_WORDS[sharing]} can play it, as the pitch page's choice does. You can change it back at any time.`,
    };
  },
  done: (out) => {
    const sharing = sharingOf(out);
    return `Done. Your pitch video "${out.title ?? "Pitch"}" can now be watched by ${SHARING_WORDS[sharing]}.`;
  },
  http: {
    method: "POST",
    path: "/v1/companies/:companyId/pitch/:mediaAssetId/details",
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      companyId: params["companyId"],
      mediaAssetId: params["mediaAssetId"],
    }),
    respond: (out) =>
      SetPitchDetailsResponseSchema.parse({ pitch: toMediaAssetDto(out) }),
  },
  tool: {
    name: "set_pitch_sharing",
    description:
      "Sets who can watch one of the person's own pitch videos -- only their organisation, investors who can find their company, or everyone on Capital Q -- and/or renames it, exactly as the pitch page's choice does. Prepared for their approval: nothing changes until they approve exactly it.",
    input: ToolInputSchema,
    references: { pitch: "MEDIA" },
    eval: {
      say: [
        "Let investors play my pitch video {name}.",
        "Make {name} visible to everyone on Capital Q.",
      ],
      names: "MEDIA",
    },
    toCanonical: async (input, context, ports) => {
      const companyId = await ports.ownCompanyId?.(context.actor);
      if (companyId === null || companyId === undefined) return null;
      return {
        companyId,
        mediaAssetId: input.pitch,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.sharing === undefined
          ? {}
          : input.sharing === "ORGANISATION"
            ? { playbackPolicy: "PRIVATE" as const }
            : {
                audience: input.sharing,
                playbackPolicy: "AUTHORISED" as const,
              }),
      };
    },
  },
});
