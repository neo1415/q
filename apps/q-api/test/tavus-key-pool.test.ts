import { describe, expect, it, vi } from "vitest";

import {
  TavusError,
  tavusFailureKind,
  type TavusClient,
} from "../src/composition/tavus/client.js";
import {
  createTavusKeyPool,
  TavusKeysExhaustedError,
  tavusKeysFrom,
} from "../src/composition/tavus/key-pool.js";

/** Owner directive 2026-10-12: every configured key is used, by index. */

const KEY = (n: number) => `tavus_test_key_${String(n).padStart(20, "0")}`;

function fakeClients(count: number) {
  const made: string[] = [];
  const clients = Array.from({ length: count }, () => ({}) as TavusClient);
  return {
    made,
    createClient: (apiKey: string) => {
      made.push(apiKey);
      return clients[made.length - 1] ?? ({} as TavusClient);
    },
    clients,
  };
}

describe("Tavus keys from configuration", () => {
  it("reads a comma or whitespace separated list, in order, de-duplicated", () => {
    expect(
      tavusKeysFrom({
        CQ_TAVUS_API_KEYS: `${KEY(1)}, ${KEY(2)}\n${KEY(3)} ${KEY(1)}`,
      }),
    ).toEqual([KEY(1), KEY(2), KEY(3)]);
  });

  it("falls back to the single TAVUS_API_KEY and skips anything not key-shaped", () => {
    expect(
      tavusKeysFrom({
        CQ_TAVUS_API_KEYS: '"quoted", short',
        TAVUS_API_KEY: KEY(9),
      }),
    ).toEqual([KEY(9)]);
    expect(tavusKeysFrom({})).toEqual([]);
  });
});

describe("classifying a refusal", () => {
  it.each([
    [401, "", "AUTH"],
    [403, "", "AUTH"],
    [402, "", "CREDIT"],
    [429, "", "QUOTA"],
    [
      400,
      '{"message":"User has reached maximum concurrent conversations"}',
      "QUOTA",
    ],
    [400, '{"message":"Insufficient credits"}', "CREDIT"],
    [400, '{"error":"Bad Request. face_id missing"}', "OTHER"],
    [500, "credits", "OTHER"],
  ] as const)("HTTP %s %s is %s", (status, body, kind) => {
    expect(tavusFailureKind(status, body)).toBe(kind);
  });
});

describe("choosing a key for a session", () => {
  it("uses the first healthy key and reports its index", async () => {
    const fake = fakeClients(3);
    const pool = createTavusKeyPool({
      keys: [KEY(1), KEY(2), KEY(3)],
      createClient: fake.createClient,
    });
    const used: number[] = [];
    const result = await pool.withHealthyKey((_client, index) => {
      used.push(index);
      return Promise.resolve("ok");
    });
    expect(result).toEqual({ value: "ok", keyIndex: 0 });
    expect(used).toEqual([0]);
    expect(pool.size).toBe(3);
  });

  it.each(["AUTH", "CREDIT", "QUOTA"] as const)(
    "moves to the next key on %s and passes the failed key over afterwards",
    async (kind) => {
      const fake = fakeClients(3);
      const failures: unknown[] = [];
      const pool = createTavusKeyPool({
        keys: [KEY(1), KEY(2), KEY(3)],
        createClient: fake.createClient,
        onKeyFailure: (event) => failures.push(event),
      });
      const first = await pool.withHealthyKey((client, index) =>
        index === 0
          ? Promise.reject(new TavusError("create conversation", 400, kind))
          : Promise.resolve(client),
      );
      expect(first.keyIndex).toBe(1);
      expect(first.value).toBe(fake.clients[1]);
      expect(failures).toEqual([{ keyIndex: 0, kind, status: 400 }]);
      const work = vi.fn((_c: TavusClient, index: number) =>
        Promise.resolve(index),
      );
      const second = await pool.withHealthyKey(work);
      expect(second.keyIndex).toBe(1);
      expect(work).toHaveBeenCalledTimes(1);
      expect(pool.health()[0]).toEqual({
        index: 0,
        healthy: false,
        lastFailure: kind,
      });
    },
  );

  it("never moves to another account for a failure that is not the key's", async () => {
    const pool = createTavusKeyPool({
      keys: [KEY(1), KEY(2)],
      createClient: fakeClients(2).createClient,
    });
    const work = vi.fn(() =>
      Promise.reject(new TavusError("create conversation", 500, "OTHER")),
    );
    await expect(pool.withHealthyKey(work)).rejects.toMatchObject({
      status: 500,
    });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("fails closed when every key is refused", async () => {
    const pool = createTavusKeyPool({
      keys: [KEY(1), KEY(2)],
      createClient: fakeClients(2).createClient,
    });
    await expect(
      pool.withHealthyKey(() =>
        Promise.reject(new TavusError("create PAL", 401, "AUTH")),
      ),
    ).rejects.toBeInstanceOf(TavusKeysExhaustedError);
  });

  it("tries a quota-limited key again after its cooldown", async () => {
    let clock = 0;
    const pool = createTavusKeyPool({
      keys: [KEY(1), KEY(2)],
      createClient: fakeClients(2).createClient,
      now: () => clock,
    });
    await pool.withHealthyKey((_c, index) =>
      index === 0
        ? Promise.reject(new TavusError("x", 429, "QUOTA"))
        : Promise.resolve(index),
    );
    clock += 61_000;
    const again = await pool.withHealthyKey((_c, index) =>
      Promise.resolve(index),
    );
    expect(again.keyIndex).toBe(0);
  });

  it("returns the client for a recorded index (cleanup with the same key), else null", () => {
    const fake = fakeClients(2);
    const pool = createTavusKeyPool({
      keys: [KEY(1), KEY(2)],
      createClient: fake.createClient,
    });
    expect(pool.clientAt(1)).toBe(fake.clients[1]);
    expect(pool.clientAt(2)).toBeNull();
    expect(pool.clientAt(-1)).toBeNull();
    expect(pool.clientAt(0.5)).toBeNull();
  });

  it("never exposes a key through its health report", () => {
    const pool = createTavusKeyPool({
      keys: [KEY(1)],
      createClient: fakeClients(1).createClient,
    });
    expect(JSON.stringify(pool.health())).not.toContain(KEY(1));
  });
});
