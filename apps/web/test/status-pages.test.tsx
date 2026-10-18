// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PageError from "../app/error";
import NotFound from "../app/not-found";

/** R30 #13 #15: the app's own not-found and error pages, with a way on. */

afterEach(cleanup);

describe("status pages", () => {
  it("not found names the problem and links home", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This page isn't here.",
    );
    expect(
      screen.getByRole("link", { name: "Go to Home" }).getAttribute("href"),
    ).toBe("/home");
  });

  it("a stale build after a deploy offers a reload, not a retry", () => {
    const error = Object.assign(new Error("Loading chunk 138 failed."), {
      name: "ChunkLoadError",
    });
    render(<PageError error={error} reset={() => undefined} />);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("any other failure offers to try again", () => {
    render(<PageError error={new Error("boom")} reset={() => undefined} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
