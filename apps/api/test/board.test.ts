import { describe, expect, it, vi } from "vitest";

import type { BoardOutcome, BoardService } from "@capital-q/board";
import { parseApiConfig } from "@capital-q/config/api";
import type { BoardItem } from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * The work board's routes (owner 2026-10-23): the owner is the resolved
 * actor, never the body or an id; adding and moving need an
 * Idempotency-Key; an item that is not theirs is a 404 and a stale
 * revision a 409, as problem details; nothing is cached.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ME = "b0000000-0000-4000-8000-000000000001";
const ITEM = "d1000000-0000-4000-8000-000000000001";
const KEY = "e1000000-0000-4000-8000-000000000001";

const item: BoardItem = {
  id: ITEM,
  kind: "TASK",
  refId: null,
  title: "Hire a head of sales",
  notes: null,
  status: "TODO",
  position: "1024.0000000000",
  dueOn: null,
  workJobId: null,
  createdBy: "PERSON",
  revision: 1,
  createdAt: "2026-10-23T21:00:00.000Z",
  updatedAt: "2026-10-23T21:00:00.000Z",
};

const ok = (replayed = false): BoardOutcome<BoardItem> => ({
  outcome: "OK",
  value: item,
  replayed,
});

function fakeBoard() {
  return {
    list: vi.fn<BoardService["list"]>(() =>
      Promise.resolve({
        items: [item],
        columns: ["TODO", "DOING", "DONE"],
        visibility: "personal_private",
      }),
    ),
    add: vi.fn<BoardService["add"]>(() => Promise.resolve(ok())),
    update: vi.fn<BoardService["update"]>(() => Promise.resolve(ok())),
    move: vi.fn<BoardService["move"]>(() => Promise.resolve(ok())),
    linkJob: vi.fn<BoardService["linkJob"]>(() => Promise.resolve(ok())),
  };
}

function appFor(board: BoardService) {
  return createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve({
            authUserId: AuthUserIdSchema.parse(
              "a0000000-0000-4000-8000-000000000001",
            ),
          }),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({
            status: "RESOLVED",
            context: {
              userId: UserIdSchema.parse(ME),
              tenantId: TENANT,
              organisationId: OrganisationIdSchema.parse(
                "d0000000-0000-4000-8000-000000000001",
              ),
              membershipId: MembershipIdSchema.parse(
                "e0000000-0000-4000-8000-000000000001",
              ),
              actorType: "HUMAN",
            },
          }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    { board },
  ).app;
}

const AUTH = { authorization: "Bearer test" };

describe("/v1/board", () => {
  it("lists the signed-in person's own board, never cached", async () => {
    const board = fakeBoard();
    const response = await appFor(board).inject({
      method: "GET",
      url: "/v1/board",
      headers: AUTH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      items: [{ id: ITEM }],
      visibility: "personal_private",
    });
    expect(board.list.mock.calls[0]?.[0]).toMatchObject({
      userId: ME,
      tenantId: TENANT,
    });
  });

  it("adds with an Idempotency-Key, as the person, and says when it was a replay", async () => {
    const board = fakeBoard();
    const app = appFor(board);
    const missing = await app.inject({
      method: "POST",
      url: "/v1/board/items",
      headers: AUTH,
      payload: { kind: "TASK", title: "Hire a head of sales" },
    });
    expect(missing.statusCode).toBe(422);
    expect(board.add).not.toHaveBeenCalled();

    const created = await app.inject({
      method: "POST",
      url: "/v1/board/items",
      headers: { ...AUTH, "idempotency-key": KEY },
      payload: { kind: "TASK", title: "Hire a head of sales" },
    });
    expect(created.statusCode).toBe(201);
    expect(board.add.mock.calls[0]?.slice(1)).toEqual([
      { kind: "TASK", title: "Hire a head of sales" },
      { by: "PERSON", idempotencyKey: KEY },
    ]);

    board.add.mockResolvedValueOnce(ok(true));
    const replayed = await app.inject({
      method: "POST",
      url: "/v1/board/items",
      headers: { ...AUTH, "idempotency-key": KEY },
      payload: { kind: "TASK", title: "Hire a head of sales" },
    });
    expect(replayed.statusCode).toBe(200);
  });

  it("refuses an item that does not say what it points at, or names an owner", async () => {
    const board = fakeBoard();
    const app = appFor(board);
    for (const payload of [
      { kind: "DOCUMENT", title: "12-month plan" },
      {
        kind: "TASK",
        title: "x",
        userId: "b0000000-0000-4000-8000-000000000009",
      },
      { kind: "TASK", title: "   " },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/board/items",
        headers: { ...AUTH, "idempotency-key": KEY },
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
    expect(board.add).not.toHaveBeenCalled();
  });

  it("answers another person's item with the 404 of a missing one, and a stale revision with a 409", async () => {
    const board = fakeBoard();
    board.update.mockResolvedValue({ outcome: "REFUSED", code: "NOT_FOUND" });
    board.move.mockResolvedValue({ outcome: "REFUSED", code: "CONFLICT" });
    const app = appFor(board);
    const notMine = await app.inject({
      method: "PATCH",
      url: `/v1/board/items/${ITEM}`,
      headers: AUTH,
      payload: { revision: 1, title: "Mine now" },
    });
    expect(notMine.statusCode).toBe(404);
    expect(notMine.headers["content-type"]).toMatch(/problem\+json/u);
    expect(notMine.json()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const stale = await app.inject({
      method: "POST",
      url: `/v1/board/items/${ITEM}/move`,
      headers: { ...AUTH, "idempotency-key": KEY },
      payload: { status: "DONE", index: 0, revision: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "RESOURCE_CONFLICT" });
  });

  it("moves only with an Idempotency-Key and a valid column", async () => {
    const board = fakeBoard();
    const app = appFor(board);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/board/items/${ITEM}/move`,
          headers: AUTH,
          payload: { status: "DOING", index: 0 },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/board/items/${ITEM}/move`,
          headers: { ...AUTH, "idempotency-key": KEY },
          payload: { status: "BLOCKED", index: 0 },
        })
      ).statusCode,
    ).toBe(422);
    const moved = await app.inject({
      method: "POST",
      url: `/v1/board/items/${ITEM}/move`,
      headers: { ...AUTH, "idempotency-key": KEY },
      payload: { status: "DOING", index: 2 },
    });
    expect(moved.statusCode).toBe(200);
    expect(board.move.mock.calls[0]?.slice(1)).toEqual([
      ITEM,
      { status: "DOING", index: 2 },
      { by: "PERSON", idempotencyKey: KEY },
    ]);
  });
});
