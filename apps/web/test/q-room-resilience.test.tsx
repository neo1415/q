// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import { QRoomStage } from "../src/features/q/room/q-room-card";
import {
  QRoomDeck,
  type DeckLoaders,
} from "../src/features/q/room/q-room-deck";
import { answerNamesDocument } from "../src/features/q/room/document-room";
import type { RoomCardResult } from "../src/features/q/room/room-actions";
import {
  roomRead,
  UPLOAD_DROPPED,
  uploadResuming,
} from "../src/features/q/room/room-read";
import type { RoomCard } from "../src/features/q/room/room-stage";
import { EDGE_STRIP, edgeDots } from "../src/features/q-swarm/edge-flow";

/**
 * Q room W6 (R9): every room surface on a weak network retries a failed
 * read once, then says "Couldn't load — try again" with a button (never
 * an endless spinner); back online retries by itself; an upload on a
 * dropped connection resumes or fails clearly.
 */

const noSleep = () => Promise.resolve();

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  setOnline(true);
});

describe("roomRead", () => {
  it("tries twice, then gives up with the failure", async () => {
    const read = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(roomRead(read, { sleep: noSleep })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns the second try when it lands, and an answer is never retried", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce("ok");
    await expect(roomRead(read, { sleep: noSleep })).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
    const answer = vi.fn(() => Promise.resolve({ ok: false }));
    await roomRead(answer, { sleep: noSleep });
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("does not park offline: it fails fast so the surface can say so", async () => {
    setOnline(false);
    const read = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(roomRead(read, { sleep: noSleep })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("uploadResuming", () => {
  it("runs once more after a drop and returns the upload", async () => {
    const run = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("doc-1");
    const waiting = vi.fn();
    await expect(
      uploadResuming(run, waiting, { pause: noSleep }),
    ).resolves.toBe("doc-1");
    expect(run).toHaveBeenCalledTimes(2);
    expect(waiting).not.toHaveBeenCalled();
  });

  it("offline, says it waits, resumes once back online", async () => {
    setOnline(false);
    const run = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("doc-2");
    const waiting = vi.fn();
    const result = await uploadResuming(run, waiting, {
      untilOnline: () => Promise.resolve(true),
    });
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(result).toBe("doc-2");
  });

  it("fails clearly when the connection never comes back, or drops twice", async () => {
    setOnline(false);
    const never = vi.fn(() => Promise.reject(new TypeError("offline")));
    await expect(
      uploadResuming(never, () => undefined, {
        untilOnline: () => Promise.resolve(false),
      }),
    ).resolves.toBe(UPLOAD_DROPPED);
    expect(never).toHaveBeenCalledTimes(1);
    setOnline(true);
    const twice = vi.fn(() => Promise.reject(new TypeError("reset")));
    await expect(
      uploadResuming(twice, () => undefined, { pause: noSleep }),
    ).resolves.toBe(UPLOAD_DROPPED);
    expect(twice).toHaveBeenCalledTimes(2);
  });

  it("a refused upload is an answer, not a drop", async () => {
    const run = vi.fn(() => Promise.resolve(null));
    await expect(uploadResuming(run, () => undefined)).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

const VIEW: RoomCardResult = {
  ok: true,
  view: {
    heading: "Ledgerline · Data room",
    lead: null,
    facts: [],
    items: [{ id: "a", title: "Cap table", meta: null }],
    more: 0,
    href: "/company/x?tab=dataroom",
    open: "Open the data room",
  },
};

function card(key: string): RoomCard {
  return {
    key,
    intent: {
      kind: "SHOW_IN_Q_ROOM",
      object: "DATA_ROOM",
      id: "00000000-0000-4000-8000-000000000001",
      title: "Ledgerline",
    },
    sources: [],
    openedAt: 1,
  };
}

describe("a room card on a weak network", () => {
  it("retries once, then offers 'try again', which loads it", async () => {
    let fail = true;
    const load = vi.fn(() =>
      fail
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(VIEW),
    );
    render(
      <QRoomStage
        open={card("r9-retry")}
        note={null}
        onClose={() => undefined}
        load={load}
      />,
    );
    expect(
      await screen.findByText(/Couldn.t load — try again/u, undefined, {
        timeout: 4_000,
      }),
    ).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-q-room-loading]")).toBeNull();
    fail = false;
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    expect(await screen.findByText("Cap table")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("coming back online retries a failed card by itself", async () => {
    let fail = true;
    const load = vi.fn(() =>
      fail
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(VIEW),
    );
    render(
      <QRoomStage
        open={card("r9-online")}
        note={null}
        onClose={() => undefined}
        load={load}
      />,
    );
    await screen.findByText(/Couldn.t load/u, undefined, { timeout: 4_000 });
    fail = false;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("Cap table")).toBeTruthy();
  });

  it("a refusal is shown as the answer it is, not retried", async () => {
    const load = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: "Not shared with you." }),
    );
    render(
      <QRoomStage
        open={card("r9-refused")}
        note={null}
        onClose={() => undefined}
        load={load}
      />,
    );
    expect(await screen.findByText("Not shared with you.")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><text>1</text></svg>`;

function deckLoaders(overrides: Partial<DeckLoaders>): DeckLoaders {
  return {
    read: () =>
      Promise.resolve({
        ok: true,
        status: "READY",
        title: "Northstar deck",
        type: "PITCH_DECK",
        version: 1,
        companyId: "c0000000-0000-4000-8000-000000000001",
        progress: null,
      }),
    slides: () =>
      Promise.resolve({ slides: [SVG, SVG], pictures: [], placeholders: [] }),
    upload: () => Promise.resolve("d0000000-0000-4000-8000-000000000009"),
    fill: () => Promise.resolve({ ok: true, version: 2 }),
    ...overrides,
  };
}

describe("the deck surface on a weak network", () => {
  it("a slides read that fails twice offers 'try again', never 'no slides'", async () => {
    let fail = true;
    const slides = vi.fn<DeckLoaders["slides"]>(() =>
      fail
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({
            slides: [SVG, SVG],
            pictures: [],
            placeholders: [],
          }),
    );
    render(
      <QRoomDeck
        artifactId="a0000000-0000-4000-8000-000000000001"
        title="Northstar deck"
        turns={[] as QTurn[]}
        openedAt={0}
        loaders={deckLoaders({ slides })}
      />,
    );
    await screen.findByText(/Couldn.t load — try again/u, undefined, {
      timeout: 4_000,
    });
    expect(screen.queryByText(/without slides/u)).toBeNull();
    expect(slides).toHaveBeenCalledTimes(2);
    fail = false;
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    expect(await screen.findByText(/2 slides/u)).toBeTruthy();
  });

  it("the deck read failing twice offers 'try again' instead of a spinner", async () => {
    let fail = true;
    const base = deckLoaders({});
    const read = vi.fn<DeckLoaders["read"]>((id) =>
      fail ? Promise.reject(new TypeError("Failed to fetch")) : base.read(id),
    );
    render(
      <QRoomDeck
        artifactId="a0000000-0000-4000-8000-000000000002"
        title="Northstar deck"
        turns={[] as QTurn[]}
        openedAt={0}
        loaders={{ ...base, read }}
      />,
    );
    await screen.findByText(/Couldn.t load/u, undefined, { timeout: 4_000 });
    expect(document.querySelector("[data-q-room-loading]")).toBeNull();
    fail = false;
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    expect(await screen.findByText(/2 slides/u)).toBeTruthy();
  });
});

describe("warming the document viewer", () => {
  const q = (text: string, blocks: unknown[] = []) =>
    ({
      kind: "Q",
      id: "q1",
      text,
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
      blocks,
    }) as unknown as QTurn;

  it("knows an answer that names or opens a document", () => {
    expect(answerNamesDocument(q("The certificate is open to you."))).toBe(
      true,
    );
    expect(
      answerNamesDocument(
        q("Here.", [
          {
            kind: "UI_INTENT",
            intent: {
              kind: "SHOW_IN_Q_ROOM",
              object: "DATA_ROOM",
              id: "x",
              title: "Ledgerline",
            },
          },
        ]),
      ),
    ).toBe(true);
    expect(answerNamesDocument(q("Clearwater made £41k in September."))).toBe(
      false,
    );
  });
});

describe("edge particles on the compositor", () => {
  it("draws the same deterministic dots along each axis, in Q's token", () => {
    const layer = EDGE_STRIP.layers[0];
    const x = edgeDots("x", layer.tilePx, layer.dots, layer.salt);
    expect(x).toBe(edgeDots("x", layer.tilePx, layer.dots, layer.salt));
    expect(x.match(/radial-gradient/gu)).toHaveLength(layer.dots);
    expect(x).toContain("var(--cq-q-light)");
    expect(x).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    const y = edgeDots("y", layer.tilePx, layer.dots, layer.salt);
    expect(y).not.toBe(x);
    expect(y).toMatch(/at 3px [\d.]+px/u);
  });
});
