// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  ARRIVAL_READ_PATH,
  arrivalDataOf,
  loadArrival,
} from "@/features/briefing/arrival-browser";

/**
 * Speed lane 2026-10-20: the browser's arrival read goes to its own route,
 * never a server action (actions run one at a time per tab, and the
 * briefing waited behind Home's others). Anything but the briefing's shape
 * is "no briefing", never an error.
 */

const DATA = {
  firstName: "Zino",
  timeZone: null,
  activity: null,
  hoursAway: 3,
  cards: [],
};

function answering(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("the arrival read's route", () => {
  it("posts the since time and this browser's part to the route", async () => {
    window.localStorage.setItem(
      "cq.work.dismissedHeld",
      JSON.stringify(["held-1"]),
    );
    const fetchImpl = answering(200, DATA);
    const data = await loadArrival("2026-10-20T06:00:00.000Z", fetchImpl);
    expect(data?.firstName).toBe("Zino");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(ARRIVAL_READ_PATH);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      since: "2026-10-20T06:00:00.000Z",
      browser: { dismissedHeld: ["held-1"] },
    });
  });

  it("is no briefing on a failed answer, a null body or another shape", async () => {
    expect(await loadArrival(null, answering(500, DATA))).toBeNull();
    expect(await loadArrival(null, answering(200, null))).toBeNull();
    expect(await loadArrival(null, answering(200, { cards: "x" }))).toBeNull();
    expect(
      await loadArrival(null, () => Promise.reject(new Error("offline"))),
    ).toBeNull();
    expect(arrivalDataOf(DATA)?.cards).toEqual([]);
  });
});
