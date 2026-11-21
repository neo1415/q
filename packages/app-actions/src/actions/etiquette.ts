import { z } from "zod";

import {
  ME_ETIQUETTE_GUIDE_PATH,
  ME_ETIQUETTE_GUIDE_VERSIONS_PATH,
  MyEtiquetteGuideDtoSchema,
  ORGANISATION_ETIQUETTE_GUIDE_PATH,
  OrganisationEtiquetteGuideDtoSchema,
  PERSONAL_ETIQUETTE_TEXT_MAX,
  SaveEtiquetteGuideRequestSchema,
  type MyEtiquetteGuideDto,
  type OrganisationEtiquetteGuideDto,
} from "@capital-q/contracts";
import type {
  EtiquetteGuideOwner,
  OrganisationEtiquetteGuide,
  OrganisationEtiquetteStore,
  OrganisationEtiquetteVersion,
  PersonalEtiquetteGuide,
  PersonalEtiquetteGuideStore,
} from "@capital-q/q-runtime";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import type { ActorContext } from "@capital-q/security";

/**
 * How Q speaks for you (ADR 0050): a person's own business etiquette guide,
 * saved or removed from Settings or by asking Q ("be more formal with
 * investors"). Their own reversible preference, so INSTANT, like Q's
 * personality: no one else's record is touched, and nothing it says can
 * widen what Q may do -- the guide is reference text for wording only.
 *
 * The owner is always the resolved actor; nothing in the input names a
 * person.
 */

export type HouseEtiquette = MyEtiquetteGuideDto["house"];

export type EtiquetteGuidePort = PersonalEtiquetteGuideStore & {
  /** Which house guide applies now (built-in, or the admin's upload). */
  readonly house: () => Promise<HouseEtiquette>;
};

type Mine = {
  readonly guide: PersonalEtiquetteGuide | null;
  readonly house: HouseEtiquette;
};

const guides = (ports: AppActionPorts) =>
  ports.etiquetteGuides ?? portMissing("etiquetteGuides");

const ownerOf = (actor: {
  readonly tenantId: string;
  readonly userId: string;
}): EtiquetteGuideOwner => ({
  tenantId: actor.tenantId,
  userId: actor.userId,
});

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** Their own guide: only ever the actor's. */
const ownOnly = () => Promise.resolve({ ok: true as const });

export const toMyEtiquetteDto = (mine: Mine): MyEtiquetteGuideDto =>
  MyEtiquetteGuideDtoSchema.parse({
    guide:
      mine.guide === null
        ? null
        : {
            version: mine.guide.version,
            sourceKind: mine.guide.sourceKind,
            fileName: mine.guide.fileName,
            mediaType: mine.guide.mediaType,
            text: mine.guide.text,
            savedAt: mine.guide.savedAt,
          },
    house: mine.house,
  });

const Save = z.object({ input: SaveEtiquetteGuideRequestSchema }).strict();
type SaveInput = z.infer<typeof Save>;

/** What Q fills when they ask it to change how it speaks for them. */
const SaveTool = z
  .object({
    change: z
      .enum(["ADD", "REPLACE"])
      .describe(
        "ADD: add their new preference to the guide they have (most requests); REPLACE: they want the whole guide to be exactly this text.",
      ),
    text: z
      .string()
      .trim()
      .min(3)
      .max(2_000)
      .describe(
        "Their preference in their own words, as a short line or two (for example: 'More formal with investors; always use titles until invited otherwise.'). Only what they asked; never invent preferences.",
      ),
  })
  .strict();
type SaveToolInput = z.infer<typeof SaveTool>;

const SAVE = defineAppAction<SaveInput, Mine, SaveToolInput>({
  name: "settings.etiquette_guide.save",
  short: "change my speaking guide",
  area: "settings",
  classification: "INSTANT",
  does: "Saves a new version of their own guide to how Q speaks for them (tone, formality, phrases to avoid, sign-off), as Settings does; it shapes Q's wording only.",
  input: Save,
  output: serviceResult(),
  authorize: ownOnly,
  run: async (ports, context, input) => {
    const port = guides(ports);
    const guide = await port.save(ownerOf(context.actor), {
      sourceKind: input.input.sourceKind,
      fileName: input.input.fileName,
      mediaType: input.input.mediaType,
      text: input.input.text,
    });
    return { guide, house: await port.house() };
  },
  targets: () => [],
  card: () => ({ summary: "Change how Q speaks for you", preview: "" }),
  done: (out) =>
    `Saved: Q follows version ${String(out.guide?.version ?? 1)} of your guide when it writes or speaks for you. You can see, change or remove it in Settings.`,
  http: {
    method: "PUT",
    path: ME_ETIQUETTE_GUIDE_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    respond: (out) => toMyEtiquetteDto(out),
  },
  tool: {
    name: "set_my_speaking_guide",
    purposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    description:
      "Changes how Q writes and speaks for them to investors and founders (tone, formality, phrases to avoid, sign-off), at once and reversibly, exactly as the guide in Settings does. Call it only when they ask Q to speak or write differently for them. It shapes wording only; it never lets Q do or say anything it otherwise could not.",
    input: SaveTool,
    references: {},
    eval: {
      say: [
        "Make Q more formal with investors.",
        "When you write for me, never use exclamation marks.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const current =
        tool.change === "REPLACE"
          ? null
          : await guides(ports).read(ownerOf(context.actor));
      const line = tool.text.trim();
      const text =
        current === null ? line : `${current.text.trimEnd()}\n- ${line}`;
      if (text.length > PERSONAL_ETIQUETTE_TEXT_MAX) {
        return refusal(
          "Your guide is already full. Open Settings to shorten it, then ask again.",
        );
      }
      // A one-line preference is still a guide: pad to the contract's
      // minimum with their own words, never with invented ones.
      const parsed = SaveEtiquetteGuideRequestSchema.safeParse({
        sourceKind: "PASTE",
        text: text.length >= 20 ? text : `How Q speaks for me: ${text}`,
      });
      return parsed.success
        ? { input: parsed.data }
        : refusal(
            "I couldn't save that as your guide. Try saying it another way.",
          );
    },
  },
});

/**
 * Settings sends nothing; Q's prepared removal names the person whose
 * guide it removes (themself), which the approval binds to as its target.
 */
const Remove = z.object({ userId: z.string().uuid().optional() }).strict();
const RemoveTool = z.object({}).strict();

const REMOVE = defineAppAction<z.infer<typeof Remove>, Mine>({
  name: "settings.etiquette_guide.remove",
  short: "remove my speaking guide",
  area: "settings",
  // RECOVERY-2026-10 (security fix 2): removal deletes every version of
  // their guide for good, so from Q it is prepared for their approval;
  // Settings' own Remove (its confirm) is unchanged.
  classification: "CONSEQUENTIAL",
  does: "Removes their own guide to how Q speaks for them, as Settings does; Q then follows Capital Q's house guide alone.",
  input: Remove,
  output: serviceResult(),
  // Only ever their own guide: a named person must be the actor.
  authorize: (_ports, context, input) =>
    Promise.resolve(
      input.userId === undefined || input.userId === context.actor.userId
        ? { ok: true as const }
        : { ok: false as const, reason: "That isn't your speaking guide." },
    ),
  run: async (ports, context) => {
    const port = guides(ports);
    await port.remove(ownerOf(context.actor));
    return { guide: null, house: await port.house() };
  },
  targets: (input) =>
    input.userId === undefined ? [] : [{ kind: "USER", userId: input.userId }],
  card: () => ({
    summary: "Remove your speaking guide",
    preview:
      "Every version of your guide is deleted and cannot be brought back; Q then follows Capital Q's house guide alone.",
  }),
  done: () =>
    "Removed. Q now follows Capital Q's house guide alone when it speaks for you.",
  http: {
    method: "DELETE",
    path: ME_ETIQUETTE_GUIDE_VERSIONS_PATH,
    fromRequest: () => ({}),
    respond: (out) => toMyEtiquetteDto(out),
  },
  tool: {
    name: "remove_my_speaking_guide",
    purposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    description:
      "Removes their own guide to how Q speaks for them, exactly as Remove in Settings does; every version is deleted for good, so it is prepared for their approval. Call it only when they ask to remove or reset it.",
    input: RemoveTool,
    references: {},
    eval: {
      say: [
        "Remove my speaking guide.",
        "Forget how I told you to write for me and go back to the default.",
      ],
    },
    toCanonical: (_input, context) =>
      Promise.resolve({ userId: context.actor.userId }),
  },
});

/**
 * Decision 112: the organisation's own guide ("How Q speaks for us"),
 * between the house guide and each person's own. Every member reads it;
 * its owners and admins (organisation.admin) write a new version; none is
 * ever rewritten. Always the actor's active organisation: nothing in the
 * input names one. A new version is reversible (write another), so
 * INSTANT, like a team's saved CRM view; Q offers the page rather than
 * writing the organisation's words itself.
 */
export type OrganisationEtiquettePort = OrganisationEtiquetteStore & {
  /** organisation.admin on the actor's active organisation. */
  readonly mayManage: (actor: ActorContext) => Promise<boolean>;
  readonly house: () => Promise<HouseEtiquette>;
};

type Ours = {
  readonly guide: OrganisationEtiquetteGuide | null;
  readonly versions: readonly OrganisationEtiquetteVersion[];
  readonly house: HouseEtiquette;
  readonly canChange: boolean;
};

const ORGANISATION_HISTORY = 20;

const organisationGuides = (ports: AppActionPorts) =>
  ports.organisationEtiquette ?? portMissing("organisationEtiquette");

/** What a member of the actor's active organisation sees; null: none. */
export async function readOrganisationEtiquette(
  port: OrganisationEtiquettePort,
  actor: ActorContext,
): Promise<Ours | null> {
  if (actor.organisationId === undefined) return null;
  const owner = {
    tenantId: actor.tenantId,
    organisationId: actor.organisationId,
  };
  const [guide, versions, house, canChange] = await Promise.all([
    port.read(owner),
    port.history(owner, ORGANISATION_HISTORY),
    port.house(),
    port.mayManage(actor),
  ]);
  return { guide, versions, house, canChange };
}

export const toOrganisationEtiquetteDto = (
  ours: Ours,
): OrganisationEtiquetteGuideDto =>
  OrganisationEtiquetteGuideDtoSchema.parse({
    guide:
      ours.guide === null
        ? null
        : {
            version: ours.guide.version,
            sourceKind: ours.guide.sourceKind,
            fileName: ours.guide.fileName,
            mediaType: ours.guide.mediaType,
            text: ours.guide.text,
            savedAt: ours.guide.savedAt,
          },
    versions: ours.versions.map((one) => ({
      version: one.version,
      sourceKind: one.sourceKind,
      fileName: one.fileName,
      characters: one.characters,
      savedAt: one.savedAt,
    })),
    house: ours.house,
    canChange: ours.canChange,
  });

const ORGANISATION_SAVE = defineAppAction<SaveInput, Ours>({
  name: "organisation.etiquette_guide.save",
  short: "change the organisation's speaking guide",
  area: "settings",
  classification: "INSTANT",
  does: "Saves a new version of the organisation's own guide to how Q writes and speaks for its members, as How Q speaks for us does (owners and admins); it shapes Q's wording only.",
  input: Save,
  output: serviceResult(),
  // Decision 110: owners and admins change it; members read it.
  authorize: async (ports, context) =>
    context.actor.organisationId !== undefined &&
    (await organisationGuides(ports).mayManage(context.actor))
      ? { ok: true as const }
      : {
          ok: false as const,
          reason:
            "Only the organisation's owners and admins can change how Q speaks for it.",
        },
  run: async (ports, context, input) => {
    const port = organisationGuides(ports);
    const { actor } = context;
    if (actor.organisationId === undefined) {
      throw new Error("authorize admits only an organisation's admin");
    }
    await port.save(
      { tenantId: actor.tenantId, organisationId: actor.organisationId },
      actor.userId,
      {
        sourceKind: input.input.sourceKind,
        fileName: input.input.fileName,
        mediaType: input.input.mediaType,
        text: input.input.text,
      },
    );
    const ours = await readOrganisationEtiquette(port, actor);
    if (ours === null) throw new Error("the organisation was just written");
    return ours;
  },
  targets: () => [],
  card: () => ({
    summary: "Change how Q speaks for the organisation",
    preview: "",
  }),
  done: (out) =>
    `Saved: Q follows version ${String(out.guide?.version ?? 1)} of the organisation's guide when it writes or speaks for its members.`,
  http: {
    method: "PUT",
    path: ORGANISATION_ETIQUETTE_GUIDE_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    respond: (out) => toOrganisationEtiquetteDto(out),
  },
  qCapability: "offer.organisation_speaking_guide",
});

export const ETIQUETTE_ACTIONS: readonly AnyAppAction[] = [
  SAVE,
  REMOVE,
  ORGANISATION_SAVE,
];
