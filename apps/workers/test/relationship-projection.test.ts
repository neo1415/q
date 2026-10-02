import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  projectRelationshipState,
  RelationshipIdSchema,
  type ProjectableEvent,
  type RelationshipId,
  type RelationshipStateProjector,
} from "@capital-q/network";
import {
  interestAnsweredEvent,
  NETWORK_EVENTS,
  relationshipCreatedEvent,
  relationshipInterestExpressedEvent,
} from "@capital-q/network/events";

import { withRelationshipProjection } from "../src/network/relationship-projection-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * The relationship state projector's consumer (CQ-NET-012). Proven here
 * against an in-memory history and an in-memory compare-and-set cache
 * with the same rule the Postgres write uses: every Network announcement
 * projects the relationship it names; duplicates, replays and any
 * delivery order converge on the state the history says; a failure
 * retries; other messages and other consumers are untouched.
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = RelationshipIdSchema.parse(
  "88888888-0000-4000-8000-000000000001",
);
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const INTEREST = "77777777-0000-4000-8000-000000000001";
const MATCH = "55555555-0000-4000-8000-000000000001";
const cor = (): CorrelationId => `cor_${randomUUID()}`;

const envelope = {
  tenantId: TENANT_A,
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorUserId: "b0000000-0000-4000-8000-000000000001",
  relationshipId: RELATIONSHIP,
  companyId: COMPANY,
  investorOrganisationId: INVESTOR,
};

function message(event: unknown, msgId: number): QueueMessage {
  return {
    msgId,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: event,
  };
}

const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 25, 10, minute)).toISOString();

/** The history the announcements report on, as the database holds it. */
const HISTORY: ProjectableEvent[] = [
  {
    sequence: 1,
    eventType: "discovered",
    occurredAt: at(1),
    visibilityScope: "investor_private",
  },
  {
    sequence: 2,
    eventType: "interest_expressed",
    occurredAt: at(2),
    visibilityScope: "relationship_shared",
  },
  {
    sequence: 3,
    eventType: "connection_accepted",
    occurredAt: at(3),
    visibilityScope: "relationship_shared",
  },
];

const ANNOUNCEMENTS = [
  relationshipCreatedEvent({ ...envelope, correlationId: cor() }),
  relationshipInterestExpressedEvent({
    ...envelope,
    correlationId: cor(),
    interestId: INTEREST,
  }),
  interestAnsweredEvent({
    ...envelope,
    correlationId: cor(),
    decision: "ACCEPTED",
    interestId: INTEREST,
    matchId: MATCH,
  }),
];

/**
 * An in-memory relationship: the history grows as announcements arrive
 * (as it does in the database, before the outbox publishes), and the
 * cache follows the Postgres write's compare-and-set.
 */
function harness(options: { readonly failing?: boolean } = {}) {
  const cache = { state: "DISCOVERED", sequence: 0, version: "none" };
  let visible = 0;
  const writes: number[] = [];
  const projector: Pick<RelationshipStateProjector, "project"> = {
    project: (relationshipId: RelationshipId) => {
      if (options.failing === true) {
        return Promise.reject(new Error("database unavailable"));
      }
      expect(relationshipId).toBe(RELATIONSHIP);
      const projection = projectRelationshipState(HISTORY.slice(0, visible));
      if (projection === null) {
        return Promise.resolve({ projection, changed: false });
      }
      const changed =
        cache.sequence < projection.throughSequence ||
        (cache.sequence === projection.throughSequence &&
          cache.version !== projection.version);
      if (changed) {
        cache.state = projection.state;
        cache.sequence = projection.throughSequence;
        cache.version = projection.version;
        writes.push(projection.throughSequence);
      }
      return Promise.resolve({ projection, changed });
    },
  };
  const passedOn: QueueMessage[] = [];
  const handle = withRelationshipProjection(
    (m): Promise<MessageOutcome> => {
      passedOn.push(m);
      return Promise.resolve({ kind: "ARCHIVE" });
    },
    { registry, projector, logger: createRecordingLogger() },
  );
  return {
    cache,
    writes,
    passedOn,
    handle,
    reveal: (n: number) => {
      visible = n;
    },
  };
}

describe("relationship state projection consumer", () => {
  it("projects the relationship each announcement names, and passes every message on", async () => {
    const h = harness();
    h.reveal(3);
    for (const [index, event] of ANNOUNCEMENTS.entries()) {
      expect(await h.handle(message(event, index + 1))).toEqual({
        kind: "ARCHIVE",
      });
    }
    expect(h.cache).toEqual({
      state: "CONNECTED",
      sequence: 3,
      version: "relationship-state.v2",
    });
    // The first projection saw the whole history; later ones changed nothing.
    expect(h.writes).toEqual([3]);
    expect(h.passedOn).toHaveLength(3);
  });

  it("converges whatever the delivery order, with duplicates and replays", async () => {
    const orders = [
      [2, 0, 1],
      [1, 2, 0, 2, 1],
      [0, 0, 2, 1, 1, 2],
    ];
    for (const order of orders) {
      const h = harness();
      h.reveal(3);
      for (const [n, index] of order.entries()) {
        await h.handle(message(ANNOUNCEMENTS[index], n + 1));
      }
      expect(h.cache.state, order.join(",")).toBe("CONNECTED");
      expect(h.cache.sequence).toBe(3);
    }
  });

  it("follows the history as it grows, and never moves backwards", async () => {
    const h = harness();
    const [created, expressed, answered] = ANNOUNCEMENTS;
    h.reveal(1);
    await h.handle(message(created, 1));
    expect(h.cache.state).toBe("DISCOVERED");
    h.reveal(2);
    await h.handle(message(expressed, 2));
    expect(h.cache.state).toBe("INTEREST_EXPRESSED");
    h.reveal(3);
    await h.handle(message(answered, 3));
    expect(h.cache.state).toBe("CONNECTED");
    // A late redelivery of the first announcement cannot rewind it.
    await h.handle(message(created, 4));
    expect(h.cache).toMatchObject({ state: "CONNECTED", sequence: 3 });
    expect(h.writes).toEqual([1, 2, 3]);
  });

  it("retries when the projection fails, without handing the message on", async () => {
    const h = harness({ failing: true });
    expect(await h.handle(message(ANNOUNCEMENTS[0], 1))).toEqual({
      kind: "RETRY",
      errorCode: "RELATIONSHIP_PROJECTION_FAILED",
    });
    expect(h.passedOn).toHaveLength(0);
  });

  it("leaves messages that are not Network announcements to the other consumers", async () => {
    const h = harness({ failing: true });
    const other = message({ type: "evidence.document.ready" }, 1);
    expect(await h.handle(other)).toEqual({ kind: "ARCHIVE" });
    expect(h.passedOn).toEqual([other]);
  });
});
