import type { NamedImageReader } from "@capital-q/public-identity";

/**
 * The pictures of the people and organisations one response names
 * (founder decision 2026-10-04: a picture has its name's scope). A route
 * passes only subjects its own authorised read is already naming to this
 * reader, after that read; one batch per response, never one per row.
 */
export type NamedPhotos = Pick<NamedImageReader, "photos" | "images">;

export {
  namedByRelationshipLink,
  photoLookup,
} from "@capital-q/public-identity";
