import { z } from "zod";

/**
 * How Q conducts business (ADR 0050): the business etiquette guides Q
 * follows when it writes or speaks for a person.
 *
 * - GET    /v1/me/etiquette-guide            the person's own guide (or none)
 *                                            and which house guide applies.
 * - PUT    /v1/me/etiquette-guide            save a new version of their own
 *                                            guide (app action, INSTANT).
 * - DELETE /v1/me/etiquette-guide/versions   remove their own guide, every
 *                                            version (app action, INSTANT).
 * - GET    /v1/admin/etiquette-guide         platform admin: the house guide
 *                                            in force, its versions and the
 *                                            built-in one.
 * - POST   /v1/admin/etiquette-guide         platform admin with step-up:
 *                                            record a new version, in force.
 * - POST   /v1/admin/etiquette-guide/active  platform admin with step-up:
 *                                            put a recorded version (or the
 *                                            built-in guide) in force.
 *
 * Only text travels. A PDF or Word file is read by the person's own browser
 * and its text sent; no file bytes reach Capital Q's servers for a guide.
 */
export const ME_ETIQUETTE_GUIDE_PATH = "/v1/me/etiquette-guide" as const;
export const ME_ETIQUETTE_GUIDE_VERSIONS_PATH =
  "/v1/me/etiquette-guide/versions" as const;
export const ADMIN_ETIQUETTE_GUIDE_PATH = "/v1/admin/etiquette-guide" as const;
export const ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH =
  "/v1/admin/etiquette-guide/active" as const;

/** Most characters of text one platform guide version may hold. */
export const PLATFORM_ETIQUETTE_TEXT_MAX = 60_000;
/** Most characters of text a person's own guide may hold. */
export const PERSONAL_ETIQUETTE_TEXT_MAX = 20_000;
/** The largest file the browser will read text from, in bytes. */
export const ETIQUETTE_FILE_BYTES_MAX = 10 * 1024 * 1024;

/** The file types a guide may come from. */
export const ETIQUETTE_MEDIA_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;
export const EtiquetteMediaTypeSchema = z.enum(ETIQUETTE_MEDIA_TYPES);
export type EtiquetteMediaType = z.infer<typeof EtiquetteMediaTypeSchema>;

export const EtiquetteSourceKindSchema = z.enum(["PASTE", "FILE"]);
export type EtiquetteSourceKind = z.infer<typeof EtiquetteSourceKindSchema>;

/** A file's own name only: no path, no control characters. */
const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point.
  .regex(/^[^/\\\u0000-\u001F\u007F]+$/u, "a file name, not a path");

/**
 * Guide text: something a person could read. NUL and other control
 * characters (bar newline and tab) are refused rather than stored, and
 * whitespace-only text is no guide.
 */
function guideText(max: number) {
  return z
    .string()
    .max(max, `at most ${String(max)} characters`)
    .refine((text) => text.trim().length >= 20, "at least a sentence or two")
    .refine(
      // eslint-disable-next-line no-control-regex -- the point is to refuse them.
      (text) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text),
      "plain text only",
    );
}

const SOURCE = {
  sourceKind: EtiquetteSourceKindSchema,
  fileName: FileNameSchema.nullable().default(null),
  mediaType: EtiquetteMediaTypeSchema.nullable().default(null),
};

const fileNamed = (value: {
  readonly sourceKind: EtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: EtiquetteMediaType | null;
}) =>
  (value.sourceKind === "FILE") ===
  (value.fileName !== null && value.mediaType !== null);
const FILE_NAMED =
  "a file guide names its file and type; pasted text names neither";

export const SaveEtiquetteGuideRequestSchema = z
  .object({ ...SOURCE, text: guideText(PERSONAL_ETIQUETTE_TEXT_MAX) })
  .strict()
  .refine(fileNamed, FILE_NAMED);
export type SaveEtiquetteGuideRequest = z.input<
  typeof SaveEtiquetteGuideRequestSchema
>;

export const AdminEtiquetteGuideRequestSchema = z
  .object({
    ...SOURCE,
    title: z.string().trim().min(1).max(120),
    text: guideText(PLATFORM_ETIQUETTE_TEXT_MAX),
  })
  .strict()
  .refine(fileNamed, FILE_NAMED);
export type AdminEtiquetteGuideRequest = z.input<
  typeof AdminEtiquetteGuideRequestSchema
>;

export const AdminEtiquetteGuideActiveRequestSchema = z
  .object({
    /** Null: Capital Q's built-in guide. */
    versionId: z.string().uuid().nullable(),
  })
  .strict();
export type AdminEtiquetteGuideActiveRequest = z.infer<
  typeof AdminEtiquetteGuideActiveRequestSchema
>;

const At = z.string().datetime({ offset: true });

export const PersonalEtiquetteGuideDtoSchema = z
  .object({
    version: z.number().int().positive(),
    sourceKind: EtiquetteSourceKindSchema,
    fileName: z.string().nullable(),
    mediaType: EtiquetteMediaTypeSchema.nullable(),
    text: z.string(),
    savedAt: At,
  })
  .strict();
export type PersonalEtiquetteGuideDto = z.infer<
  typeof PersonalEtiquetteGuideDtoSchema
>;

/** Which house guide applies: the built-in one or an admin's upload. */
export const HouseEtiquetteDtoSchema = z
  .object({
    source: z.enum(["BUILT_IN", "UPLOADED"]),
    title: z.string(),
    version: z.string(),
  })
  .strict();

export const MyEtiquetteGuideDtoSchema = z
  .object({
    guide: PersonalEtiquetteGuideDtoSchema.nullable(),
    house: HouseEtiquetteDtoSchema,
  })
  .strict();
export type MyEtiquetteGuideDto = z.infer<typeof MyEtiquetteGuideDtoSchema>;

export const PlatformEtiquetteVersionDtoSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    title: z.string(),
    sourceKind: EtiquetteSourceKindSchema,
    fileName: z.string().nullable(),
    mediaType: EtiquetteMediaTypeSchema.nullable(),
    characters: z.number().int().nonnegative(),
    createdBy: z.string().nullable(),
    createdAt: At,
  })
  .strict();
export type PlatformEtiquetteVersionDto = z.infer<
  typeof PlatformEtiquetteVersionDtoSchema
>;

export const AdminEtiquetteGuideDtoSchema = z
  .object({
    /** Null: the built-in guide is in force. */
    activeVersionId: z.string().uuid().nullable(),
    activeText: z.string(),
    activeTitle: z.string(),
    updatedAt: At.nullable(),
    builtIn: z
      .object({ version: z.string(), title: z.string(), text: z.string() })
      .strict(),
    /** Newest first. */
    versions: z.array(PlatformEtiquetteVersionDtoSchema),
  })
  .strict();
export type AdminEtiquetteGuideDto = z.infer<
  typeof AdminEtiquetteGuideDtoSchema
>;
