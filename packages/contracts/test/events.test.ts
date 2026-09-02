import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createEventSchema,
  EVENT_SPEC_VERSION,
  EventSourceSchema,
  EventTypeSchema,
} from "../src/events/envelope.js";
import { defineEvent } from "../src/events/definition.js";
import { createEventRegistry } from "../src/events/registry.js";

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const TENANT_ID = "223e4567-e89b-12d3-a456-426614174000";
const CORRELATION_ID = "cor_123e4567-e89b-12d3-a456-426614174000";
const CAUSATION_ID = "cau_123e4567-e89b-12d3-a456-426614174000";

/**
 * Test-only contract. Named so it can never be mistaken for a product event,
 * and defined inside test source so it is not exported by the package.
 */
const FixtureCreated = defineEvent({
  name: "test.fixture.created",
  version: 1,
  owner: "test",
  producer: "capitalq://api/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({
    fixtureId: z.uuid(),
    changedFields: z.array(z.string()),
  }),
  description: "Test fixture created.",
});

function validEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    specVersion: EVENT_SPEC_VERSION,
    id: EVENT_ID,
    type: "test.fixture.created",
    source: "capitalq://api/test/fixture",
    time: "2026-09-02T13:10:00Z",
    dataContentType: "application/json",
    eventVersion: 1,
    data: { fixtureId: EVENT_ID, changedFields: ["stage"] },
    ...overrides,
  };
}

const Schema = createEventSchema(FixtureCreated.dataSchema);

describe("event envelope", () => {
  it("accepts a canonical event", () => {
    expect(Schema.safeParse(validEvent()).success).toBe(true);
  });

  it("pins specVersion to 1.0", () => {
    expect(EVENT_SPEC_VERSION).toBe("1.0");
    expect(Schema.safeParse(validEvent({ specVersion: "2.0" })).success).toBe(
      false,
    );
    // The envelope spec version is not the event's semantic version.
    expect(Schema.safeParse(validEvent({ specVersion: 1 })).success).toBe(
      false,
    );
  });

  it("pins dataContentType to application/json", () => {
    expect(
      Schema.safeParse(validEvent({ dataContentType: "application/xml" }))
        .success,
    ).toBe(false);
  });

  it("requires a UUID event id", () => {
    expect(Schema.safeParse(validEvent({ id: "not-a-uuid" })).success).toBe(
      false,
    );
  });

  it("requires a UTC timestamp, never a Date", () => {
    expect(
      Schema.safeParse(validEvent({ time: "2026-09-02T14:10:00+01:00" }))
        .success,
    ).toBe(false);
    expect(
      Schema.safeParse(validEvent({ time: new Date("2026-09-02T13:10:00Z") }))
        .success,
    ).toBe(false);
  });

  it("carries tenant, actor, correlation, causation and aggregate metadata", () => {
    const result = Schema.safeParse(
      validEvent({
        tenantId: TENANT_ID,
        organisationId: TENANT_ID,
        actor: { type: "Q", id: "q-runtime" },
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID,
        aggregate: { type: "fixture", id: EVENT_ID, version: 3 },
        subject: "fixture/123",
      }),
    );

    expect(result.success).toBe(true);
  });

  it.each(["HUMAN", "Q", "SYSTEM", "CONNECTED_SYSTEM"])(
    "accepts the actor type %s",
    (type) => {
      expect(Schema.safeParse(validEvent({ actor: { type } })).success).toBe(
        true,
      );
    },
  );

  it("rejects an unknown actor type", () => {
    expect(
      Schema.safeParse(validEvent({ actor: { type: "ROBOT" } })).success,
    ).toBe(false);
  });

  it("rejects a zero or negative aggregate version", () => {
    expect(
      Schema.safeParse(
        validEvent({
          aggregate: { type: "fixture", id: EVENT_ID, version: 0 },
        }),
      ).success,
    ).toBe(false);
  });

  it("has no global sequence field on the envelope", () => {
    // Offering one would invite consumers to depend on a total order Capital Q
    // does not provide.
    const parsed = Schema.parse(validEvent({ globalSequence: 42 })) as Record<
      string,
      unknown
    >;

    expect(parsed).not.toHaveProperty("globalSequence");
  });

  it("validates the payload rather than accepting any object", () => {
    expect(
      Schema.safeParse(validEvent({ data: { fixtureId: "nope" } })).success,
    ).toBe(false);
    expect(Schema.safeParse(validEvent({ data: {} })).success).toBe(false);
  });
});

describe("event type naming", () => {
  it.each([
    "core.company.updated",
    "core.capital_objective.created",
    "evidence.document.ready",
    "network.relationship.interest_expressed",
    "permissions.access.revoked",
    "q.action.executed",
    "recommendation.slate.generated",
  ])("accepts the architecture example %s", (name) => {
    expect(EventTypeSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    "CompanyUpdated",
    "PROCESS_DOCUMENT",
    "company-update",
    "core.company",
    "core.company.updated.again",
    "Core.Company.Updated",
    "core..updated",
    "",
  ])("rejects the malformed name %s", (name) => {
    expect(EventTypeSchema.safeParse(name).success).toBe(false);
  });
});

describe("event source naming", () => {
  it.each([
    "capitalq://api/core/company",
    "capitalq://q-api/actions",
    "capitalq://workers/evidence",
  ])("accepts %s", (source) => {
    expect(EventSourceSchema.safeParse(source).success).toBe(true);
  });

  it("rejects a deployment hostname as message identity", () => {
    // Topology must not become contract semantics.
    expect(
      EventSourceSchema.safeParse(
        "https://railway-production-abc.up.railway.app",
      ).success,
    ).toBe(false);
    expect(EventSourceSchema.safeParse("api/core/company").success).toBe(false);
  });
});

describe("event registry", () => {
  const registry = createEventRegistry([FixtureCreated]);

  it("looks a definition up by type and version", () => {
    expect(registry.has("test.fixture.created", 1)).toBe(true);
    expect(registry.get("test.fixture.created", 1)?.owner).toBe("test");
    expect(registry.list()).toHaveLength(1);
  });

  it("exposes the full definition metadata as the catalogue", () => {
    const definition = registry.list()[0];

    expect(definition?.name).toBe("test.fixture.created");
    expect(definition?.version).toBe(1);
    expect(definition?.owner).toBe("test");
    expect(definition?.producer).toBe("capitalq://api/test/fixture");
    expect(definition?.consumers).toEqual(["test"]);
    expect(definition?.sensitivity).toBe("INTERNAL");
    expect(definition?.replaySafety).toBe("REPLAY_SAFE");
    expect(definition?.description.length).toBeGreaterThan(0);
  });

  it("rejects duplicate registration rather than letting the last one win", () => {
    expect(() => createEventRegistry([FixtureCreated, FixtureCreated])).toThrow(
      /Duplicate event definition/,
    );
  });

  it("accepts a valid registered event", () => {
    const result = registry.parse(validEvent());
    expect(result.ok).toBe(true);
  });

  it("distinguishes an unknown type from an unsupported version", () => {
    const unknownType = registry.parse(
      validEvent({ type: "core.company.updated" }),
    );
    const unknownVersion = registry.parse(validEvent({ eventVersion: 7 }));

    expect(unknownType.ok).toBe(false);
    expect(unknownVersion.ok).toBe(false);
    if (!unknownType.ok) expect(unknownType.rejection).toBe("UNKNOWN_TYPE");
    if (!unknownVersion.ok) {
      // A breaking version is never guessed at by assuming it resembles a
      // version this build understands.
      expect(unknownVersion.rejection).toBe("UNSUPPORTED_VERSION");
      expect(unknownVersion.version).toBe(7);
    }
  });

  it("distinguishes a malformed envelope from a bad payload", () => {
    const badEnvelope = registry.parse({ nope: true });
    const badPayload = registry.parse(validEvent({ data: { fixtureId: 1 } }));

    if (!badEnvelope.ok) expect(badEnvelope.rejection).toBe("INVALID_ENVELOPE");
    if (!badPayload.ok) expect(badPayload.rejection).toBe("INVALID_PAYLOAD");
  });

  it("recovers the payload type through parseAs", () => {
    const result = registry.parseAs(FixtureCreated, validEvent());

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Typed access, no cast required at the call site.
      expect(result.message.data.changedFields).toEqual(["stage"]);
    }
  });

  it("never puts the payload in a rejection", () => {
    const result = registry.parse(
      validEvent({
        data: { fixtureId: "super-secret-test-value", changedFields: [] },
      }),
    );

    expect(result.ok).toBe(false);
    // A rejected message is exactly what gets logged.
    expect(JSON.stringify(result)).not.toContain("super-secret-test-value");
  });
});

describe("definition metadata validation", () => {
  const base = {
    name: "test.fixture.created",
    version: 1,
    owner: "test",
    producer: "capitalq://api/test/fixture",
    consumers: [],
    sensitivity: "INTERNAL" as const,
    replaySafety: "REPLAY_SAFE" as const,
    dataSchema: z.object({}),
    description: "Test fixture.",
  };

  it("rejects an imperative, command-shaped event name at definition time", () => {
    expect(() =>
      defineEvent({ ...base, name: "network.relationship.create-match" }),
    ).toThrow();
  });

  it("rejects a version below 1", () => {
    expect(() => defineEvent({ ...base, version: 0 })).toThrow();
  });

  it("rejects an invented sensitivity class", () => {
    expect(() =>
      defineEvent({
        ...base,
        sensitivity: "SUPER_SECRET" as unknown as typeof base.sensitivity,
      }),
    ).toThrow();
  });

  it("rejects a disclosure scope used as a sensitivity class", () => {
    // ADR-001 disclosure scopes answer who may see something; sensitivity
    // answers how damaging exposure would be. The two must not merge.
    for (const scope of [
      "founder_private",
      "investor_private",
      "network_visible",
      "public_external",
    ]) {
      expect(() =>
        defineEvent({
          ...base,
          sensitivity: scope as unknown as typeof base.sensitivity,
        }),
      ).toThrow();
    }
  });

  it("rejects an invented replay class", () => {
    expect(() =>
      defineEvent({
        ...base,
        replaySafety: "MAYBE" as unknown as typeof base.replaySafety,
      }),
    ).toThrow();
  });
});
