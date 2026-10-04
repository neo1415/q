import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createNamedImageReader,
  namedByRelationshipLink,
  namedImageKey,
  photoLookup,
  type NamedImageStore,
  type NamedImageSubject,
  type ProfileImageStorage,
} from "../src/index.js";

/**
 * The pictures of who a list names (founder decision 2026-10-04): a
 * person's photo and an organisation's logo with the name, a cover only
 * under the card's own cover scope; one read and one signing call.
 */

const PERSON: NamedImageSubject = {
  subjectType: "PERSON",
  subjectId: "b0000000-0000-4000-8000-000000000001",
};
const COMPANY: NamedImageSubject = {
  subjectType: "COMPANY",
  subjectId: "c0000000-0000-4000-8000-000000000001",
};
const INVESTOR: NamedImageSubject = {
  subjectType: "INVESTOR_ORGANISATION",
  subjectId: "d0000000-0000-4000-8000-000000000001",
};

function setup(options: { readonly batch: boolean }) {
  const signCalls: (readonly string[])[] = [];
  const imagesAsked: (readonly NamedImageSubject[])[] = [];
  const store: NamedImageStore = {
    readyImages: (_sql, subjects) => {
      imagesAsked.push(subjects);
      return Promise.resolve(
        subjects.flatMap((subject) => [
          {
            subject,
            kind: "AVATAR" as const,
            objectKey: `a/${subject.subjectId}`,
          },
          {
            subject,
            kind: "COVER" as const,
            objectKey: `c/${subject.subjectId}`,
          },
        ]),
      );
    },
    activeCardScopes: () =>
      Promise.resolve(
        new Map<string, unknown>([
          [namedImageKey(COMPANY), { cover: "public_external" }],
          [namedImageKey(INVESTOR), { cover: "network_visible" }],
        ]),
      ),
  };
  const url = (key: string) => `https://storage.test/object/sign/${key}`;
  const storage = {
    createDownloadAuthorization: ({ object }: { object: { key: string } }) => {
      signCalls.push([object.key]);
      return Promise.resolve({ url: url(object.key) });
    },
    ...(options.batch
      ? {
          createDownloadAuthorizations: ({
            keys,
          }: {
            keys: readonly string[];
          }) => {
            signCalls.push(keys);
            return Promise.resolve(keys.map(url));
          },
        }
      : {}),
  } as unknown as ProfileImageStorage;
  const reader = createNamedImageReader({
    sql: {} as DatabaseExecutor,
    store,
    storage,
  });
  return { reader, signCalls, imagesAsked, url };
}

describe("the named-images reader", () => {
  it("signs a named person's photo and organisations' logos, never a cover, in one call", async () => {
    const { reader, signCalls, url } = setup({ batch: true });
    const photos = await reader.photos([PERSON, COMPANY, INVESTOR, PERSON]);
    expect(photos).toEqual(
      new Map([
        [namedImageKey(PERSON), url(`a/${PERSON.subjectId}`)],
        [namedImageKey(COMPANY), url(`a/${COMPANY.subjectId}`)],
        [namedImageKey(INVESTOR), url(`a/${INVESTOR.subjectId}`)],
      ]),
    );
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0]?.some((key) => key.startsWith("c/"))).toBe(false);
  });

  it("gives a cover only where the card's cover scope reaches the audience", async () => {
    const { reader, url } = setup({ batch: true });
    const pub = await reader.images([PERSON, COMPANY, INVESTOR], "PUBLIC");
    expect(pub.get(namedImageKey(COMPANY))?.cover).toBe(
      url(`c/${COMPANY.subjectId}`),
    );
    // Network-only cover: not for the public; a person's cover: never.
    expect(pub.get(namedImageKey(INVESTOR))?.cover).toBeNull();
    expect(pub.get(namedImageKey(PERSON))?.cover).toBeNull();
    const signedIn = await reader.images([INVESTOR], "PARTICIPANT");
    expect(signedIn.get(namedImageKey(INVESTOR))?.cover).toBe(
      url(`c/${INVESTOR.subjectId}`),
    );
  });

  it("signs one by one when the storage has no batch call", async () => {
    const { reader, signCalls } = setup({ batch: false });
    const photos = await reader.photos([PERSON, COMPANY]);
    expect(photos.size).toBe(2);
    expect(signCalls).toHaveLength(2);
  });

  it("reads and signs nothing for an empty list or without storage", async () => {
    const { reader, signCalls, imagesAsked } = setup({ batch: true });
    expect((await reader.photos([])).size).toBe(0);
    expect(signCalls).toEqual([]);
    expect(imagesAsked).toEqual([]);
    const without = createNamedImageReader({
      sql: {} as DatabaseExecutor,
      store: {
        readyImages: () => Promise.reject(new Error("must not read")),
        activeCardScopes: () => Promise.reject(new Error("must not read")),
      },
    });
    expect((await without.photos([PERSON])).size).toBe(0);
  });

  it("a lookup never fails a list: a reader error is no picture", async () => {
    const lookup = await photoLookup(
      { photos: () => Promise.reject(new Error("storage down")) },
      [PERSON],
    );
    expect(lookup(PERSON)).toBeNull();
  });
});

describe("a link to the person's own relationship names its other side", () => {
  it("reads the side and id, and nothing else", () => {
    expect(
      namedByRelationshipLink(`/relationships/company/${COMPANY.subjectId}`),
    ).toEqual(COMPANY);
    expect(
      namedByRelationshipLink(
        `/relationships/investor/${INVESTOR.subjectId}/messages`,
      ),
    ).toEqual(INVESTOR);
    for (const path of [
      null,
      "/documents",
      "/relationships/company/not-an-id",
      `/relationshipsx/company/${COMPANY.subjectId}`,
      `/relationships/person/${PERSON.subjectId}`,
    ]) {
      expect(namedByRelationshipLink(path)).toBeNull();
    }
  });
});
