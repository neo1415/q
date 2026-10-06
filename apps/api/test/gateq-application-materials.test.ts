import { describe, expect, it } from "vitest";

import { IntakeRefusedError } from "@capital-q/gateq-intake";
import type { ActorContext } from "@capital-q/security";

import {
  createApplicationMaterials,
  MaterialNotSharableError,
} from "../src/gateq/application-materials.js";

/**
 * F1 consent: a signed-in founder's ticked documents reach an application
 * only if every one is their own organisation's, and only with a real
 * guest credential. Nothing is half-shared.
 */

const FOUNDER = { userId: "u1", tenantId: "t1" } as unknown as ActorContext;
const OWN = "00000000-0000-4000-8000-0000000000d1";
const OTHERS = "00000000-0000-4000-8000-0000000000d9";
const TOKEN = `gqs_${"c".repeat(43)}`;

function build() {
  const attached: string[] = [];
  const materials = createApplicationMaterials({
    authoriseGuest: (token) =>
      token === TOKEN
        ? Promise.resolve({})
        : Promise.reject(new IntakeRefusedError("SESSION_INVALID")),
    ownDocument: (_actor, id) => Promise.resolve(id === OWN),
    attach: ({ documentId }) => {
      attached.push(documentId);
      return Promise.resolve();
    },
  });
  return { materials, attached };
}

describe("sharing documents with a GateQ application (F1)", () => {
  it("attaches the founder's own ticked documents, once each", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN, OWN],
      }),
    ).resolves.toEqual({ attached: 1 });
    expect(attached).toEqual([OWN]);
  });

  it("refuses another organisation's document and shares nothing", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN, OTHERS],
      }),
    ).rejects.toBeInstanceOf(MaterialNotSharableError);
    expect(attached).toEqual([]);
  });

  it("refuses a forged credential before looking at any document", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: `gqs_${"z".repeat(43)}`,
        documentIds: [OWN],
      }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
    expect(attached).toEqual([]);
  });
});
