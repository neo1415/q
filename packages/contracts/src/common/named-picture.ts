import { z } from "zod";

import { UuidSchema } from "./ids.js";

/**
 * Who a row names, with their picture (founder decision 2026-10-04: a
 * person's photo, or an organisation's logo, has the scope of their name).
 * The server signs `photoUrl` for this reader only because the same
 * response names them; null means there is no picture to show.
 */
export const NamedPictureSchema = z
  .object({
    kind: z.enum(["PERSON", "COMPANY", "INVESTOR_ORGANISATION"]),
    id: UuidSchema,
    photoUrl: z.string().url().nullable(),
  })
  .strict();
export type NamedPicture = z.infer<typeof NamedPictureSchema>;
