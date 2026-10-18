import type { DatabaseExecutor } from "@capital-q/database";

import {
  projectCardFields,
  readStoredScopes,
  type CardAudience,
} from "../domain/card.js";
import {
  PROFILE_IMAGE_BUCKET,
  PROFILE_IMAGE_READ_TTL_SECONDS,
  type ProfileImageStorage,
  type ProfileImageSubject,
} from "./profile-images.js";

/**
 * Pictures for the people and organisations a list names (founder
 * decision 2026-10-04: "they're literally profile pictures, not social
 * security numbers... make them show").
 *
 * The rule: a person's photo, and a company's or investor organisation's
 * logo, is visible to whoever may already see that person's or
 * organisation's NAME on the surface in question. This reader therefore
 * decides nothing about who may see whom. The caller passes only subjects
 * whose names it is returning to this reader on this response, after its
 * own read authorised them; a subject it would not name must never be
 * passed. The cover is not a name-level picture: it keeps the Q Card's
 * own `cover` scope (organisations only; a person's cover stays theirs).
 *
 * One query reads every current image; one provider call signs them. URLs
 * are short-lived and minted per response, never stored.
 */

export type NamedImageSubject = ProfileImageSubject;

export type NamedImages = {
  readonly photo: string | null;
  readonly cover: string | null;
};

export function namedImageKey(subject: NamedImageSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

/** The storage read behind the reader: current images and card scopes. */
export type NamedImageStore = {
  readonly readyImages: (
    sql: DatabaseExecutor,
    subjects: readonly NamedImageSubject[],
  ) => Promise<
    readonly {
      readonly subject: NamedImageSubject;
      readonly kind: "AVATAR" | "COVER";
      readonly objectKey: string;
    }[]
  >;
  /** Each organisation's ACTIVE card's stored field scopes. */
  readonly activeCardScopes: (
    sql: DatabaseExecutor,
    subjects: readonly NamedImageSubject[],
  ) => Promise<ReadonlyMap<string, unknown>>;
};

export type NamedImageReader = {
  /** The photo (or logo) of each named subject; absent ones are left out. */
  readonly photos: (
    subjects: readonly NamedImageSubject[],
  ) => Promise<ReadonlyMap<string, string>>;
  /**
   * Photo by the name's rule, and an organisation's cover only where its
   * card's `cover` scope reaches the audience.
   */
  readonly images: (
    subjects: readonly NamedImageSubject[],
    coverAudience: CardAudience,
  ) => Promise<ReadonlyMap<string, NamedImages>>;
};

/** A list never names more than this many; the rest read as initials. */
const MAX_SUBJECTS = 200;

function distinct(
  subjects: readonly NamedImageSubject[],
): readonly NamedImageSubject[] {
  const seen = new Map<string, NamedImageSubject>();
  for (const subject of subjects) {
    if (seen.size >= MAX_SUBJECTS) break;
    seen.set(namedImageKey(subject), subject);
  }
  return [...seen.values()];
}

export function createNamedImageReader(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly store: NamedImageStore;
  /** Absent: no picture is ever signed; every list reads as initials. */
  readonly storage?: ProfileImageStorage | undefined;
}): NamedImageReader {
  const { sql, store, storage } = dependencies;

  const sign = async (
    keys: readonly string[],
  ): Promise<readonly (string | null)[]> => {
    if (storage === undefined || keys.length === 0) return [];
    const batch = storage.createDownloadAuthorizations;
    if (batch !== undefined) {
      return batch({
        bucket: PROFILE_IMAGE_BUCKET,
        keys,
        expiresInSeconds: PROFILE_IMAGE_READ_TTL_SECONDS,
      }).catch(() => keys.map(() => null));
    }
    return Promise.all(
      keys.map((key) =>
        storage
          .createDownloadAuthorization({
            object: { bucket: PROFILE_IMAGE_BUCKET, key },
            expiresInSeconds: PROFILE_IMAGE_READ_TTL_SECONDS,
          })
          .then(({ url }) => url)
          .catch(() => null),
      ),
    );
  };

  const read = async (
    subjects: readonly NamedImageSubject[],
    coverAudience: CardAudience | null,
  ): Promise<ReadonlyMap<string, NamedImages>> => {
    const wanted = distinct(subjects);
    if (storage === undefined || wanted.length === 0) return new Map();
    const organisations = wanted.filter(
      (subject) => subject.subjectType !== "PERSON",
    );
    const [rows, cards] = await Promise.all([
      store.readyImages(sql, wanted),
      coverAudience === null || organisations.length === 0
        ? Promise.resolve(new Map<string, unknown>())
        : store.activeCardScopes(sql, organisations),
    ]);
    // A cover is signed only where the card's own projection shows it.
    const coverShown = (subject: NamedImageSubject): boolean => {
      if (coverAudience === null || subject.subjectType === "PERSON") {
        return false;
      }
      const stored = cards.get(namedImageKey(subject));
      if (stored === undefined) return false;
      return projectCardFields(
        subject.subjectType,
        readStoredScopes(subject.subjectType, stored),
        { cover: "shown" },
        coverAudience,
      ).some((field) => field.key === "cover");
    };
    const picked = rows.filter(
      (row) => row.kind === "AVATAR" || coverShown(row.subject),
    );
    const urls = await sign(picked.map((row) => row.objectKey));
    const out = new Map<
      string,
      { photo: string | null; cover: string | null }
    >();
    picked.forEach((row, index) => {
      const url = urls[index] ?? null;
      if (url === null) return;
      const key = namedImageKey(row.subject);
      const entry = out.get(key) ?? { photo: null, cover: null };
      if (row.kind === "AVATAR") entry.photo = url;
      else entry.cover = url;
      out.set(key, entry);
    });
    return out;
  };

  return {
    photos: async (subjects) => {
      const images = await read(subjects, null);
      const out = new Map<string, string>();
      for (const [key, value] of images) {
        if (value.photo !== null) out.set(key, value.photo);
      }
      return out;
    },
    images: (subjects, coverAudience) => read(subjects, coverAudience),
  };
}

/**
 * One batch for a response, read back per subject. A picture never fails
 * a list: a missing reader or any error reads as "no picture".
 */
export async function photoLookup(
  reader: Pick<NamedImageReader, "photos"> | undefined,
  subjects: readonly NamedImageSubject[],
): Promise<(subject: NamedImageSubject) => string | null> {
  if (reader === undefined || subjects.length === 0) return () => null;
  const photos = await reader
    .photos(subjects)
    .catch(() => new Map<string, string>());
  return (subject) => photos.get(namedImageKey(subject)) ?? null;
}

const RELATIONSHIP_LINK =
  /^\/relationships\/(company|investor)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?]|$)/u;

/**
 * The other side a link to the person's own relationship page names
 * (`/relationships/company/<id>` or `/relationships/investor/<id>`), for
 * a notice or a work row that points there. Anything else names no one.
 */
export function namedByRelationshipLink(
  linkPath: string | null,
): NamedImageSubject | null {
  const match = linkPath === null ? null : RELATIONSHIP_LINK.exec(linkPath);
  const id = match?.[2];
  if (match === null || id === undefined) return null;
  return {
    subjectType: match[1] === "company" ? "COMPANY" : "INVESTOR_ORGANISATION",
    subjectId: id,
  };
}
