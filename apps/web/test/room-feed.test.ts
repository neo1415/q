import { describe, expect, it } from "vitest";

import type { QRoomEntry, QRoomRead } from "@capital-q/contracts";

import { startRoomFeed, type RoomRead } from "../src/features/q/room-feed";

/** voice-cards: the browser's reader of the person's Q room feed. */

const NOW = Date.parse("2026-10-08T03:22:30.000Z");

const entry = (
  sequence: number,
  messageId: string,
  createdAt = "2026-10-08T03:22:25.000Z",
): QRoomEntry =>
  ({
    sequence,
    runId: "f0000000-0000-4000-8000-000000000020",
    conversationId: "f0000000-0000-4000-8000-000000000021",
    source: "VOICE",
    message: {
      messageId,
      runId: "f0000000-0000-4000-8000-000000000020",
      role: "Q",
      text: "Here.",
      createdAt,
    },
  }) as QRoomEntry;

/** Answers each read from a script, then holds until stopped. */
function scripted(reads: readonly QRoomRead[]) {
  const asked: { after: number; epoch: string | undefined; wait: boolean }[] =
    [];
  let at = 0;
  const read: RoomRead = ({ after, epoch, wait, signal }) => {
    asked.push({ after, epoch, wait });
    const next = reads[at];
    at += 1;
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) =>
      signal.addEventListener("abort", () => resolve(null), { once: true }),
    );
  };
  return { read, asked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("the room feed reader", () => {
  it("hands each answer over once, in order, and follows the cursor", async () => {
    const got: string[] = [];
    const { read, asked } = scripted([
      { epoch: "e1", cursor: 0, entries: [] },
      { epoch: "e1", cursor: 2, entries: [entry(2, "m2"), entry(1, "m1")] },
      // The same answer again (a retried read): not handed over twice.
      { epoch: "e1", cursor: 3, entries: [entry(2, "m2"), entry(3, "m3")] },
    ]);
    const reader = startRoomFeed({
      read,
      now: () => NOW,
      onEntries: (entries) =>
        got.push(...entries.map((one) => one.message.messageId)),
    });
    await settle();
    reader.stop();
    expect(got).toEqual(["m1", "m2", "m3"]);
    // First read at once, then held reads after the cursor, same epoch.
    expect(asked.slice(0, 4)).toEqual([
      { after: 0, epoch: undefined, wait: false },
      { after: 0, epoch: "e1", wait: true },
      { after: 2, epoch: "e1", wait: true },
      { after: 3, epoch: "e1", wait: true },
    ]);
  });

  it("does not replay old history on the first read, but keeps a just-landed answer", async () => {
    const got: string[] = [];
    const { read } = scripted([
      {
        epoch: "e1",
        cursor: 2,
        entries: [
          entry(1, "old", "2026-10-08T02:00:00.000Z"),
          entry(2, "just-now", "2026-10-08T03:22:20.000Z"),
        ],
      },
    ]);
    const reader = startRoomFeed({
      read,
      now: () => NOW,
      onEntries: (entries) =>
        got.push(...entries.map((one) => one.message.messageId)),
    });
    await settle();
    reader.stop();
    expect(got).toEqual(["just-now"]);
  });

  it("starts again when the Q API restarted (a new epoch)", async () => {
    const got: string[] = [];
    const { read, asked } = scripted([
      { epoch: "e1", cursor: 5, entries: [] },
      { epoch: "e2", cursor: 1, entries: [entry(1, "after-restart")] },
    ]);
    const reader = startRoomFeed({
      read,
      now: () => NOW,
      onEntries: (entries) =>
        got.push(...entries.map((one) => one.message.messageId)),
    });
    await settle();
    reader.stop();
    expect(got).toEqual(["after-restart"]);
    expect(asked[2]).toEqual({ after: 1, epoch: "e2", wait: true });
  });

  it("waits and reads again after a failed read", async () => {
    const got: string[] = [];
    let calls = 0;
    const read: RoomRead = ({ signal }) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("offline"));
      if (calls === 2) {
        return Promise.resolve({
          epoch: "e1",
          cursor: 1,
          entries: [entry(1, "m1")],
        });
      }
      return new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(null), { once: true }),
      );
    };
    const waits: number[] = [];
    const reader = startRoomFeed({
      read,
      now: () => NOW,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      onEntries: (entries) =>
        got.push(...entries.map((one) => one.message.messageId)),
    });
    await settle();
    reader.stop();
    expect(waits).toEqual([2_000]);
    expect(got).toEqual(["m1"]);
  });
});
