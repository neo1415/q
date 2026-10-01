import { describe, expect, it } from "vitest";

import { pointTargetFor } from "../src/features/q-swarm/point-target";

/**
 * Where the page pointer flies when Q names a control. The swarm's own
 * figures and motion are tested in presence.test.ts (PRESENCE spec).
 */
describe("where the swarm points on the page", () => {
  const element = (name: string) => ({ name }) as unknown as Element;

  it("finds the control Q names, preferring the longer label", () => {
    const call = element("call");
    const book = element("book");
    expect(
      pointTargetFor("You can Book a call from here.", [
        { label: "Call", element: call },
        { label: "Book a call", element: book },
      ]),
    ).toBe(book);
  });

  it("matches whole words only, and nothing when nothing is named", () => {
    expect(
      pointTargetFor("That is discoverable.", [
        { label: "Discover", element: element("d") },
      ]),
    ).toBeNull();
  });
});
