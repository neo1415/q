// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QWorkDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout: vi.fn() }),
}));
vi.mock("../src/features/work/work-actions", () => ({
  answerWorkAction: vi.fn(),
  listWorkAction: () => new Promise(() => undefined),
  setAwayAction: vi.fn(),
  stopWorkAction: vi.fn(),
}));

const { WorkPanel } = await import("../src/features/work/work-panel");

afterEach(cleanup);

function work(id: string, status: QWorkDto["status"], summary: string) {
  return {
    id,
    kind: "INVESTOR_OUTREACH",
    status,
    summary,
    createdAt: "2026-10-03T10:00:00Z",
    expiresAt: "2026-11-03T10:00:00Z",
    lanes: [],
  } satisfies QWorkDto;
}

/**
 * demo-44 phone pass: the Q's work page listed stopped plans under
 * "Q is working on", first.
 */
describe("the Q's work page", () => {
  it("leads with running plans and does not call stopped ones running", () => {
    render(
      <WorkPanel
        variant="page"
        initial={[
          work("00000000-0000-4000-8000-000000000001", "STOPPED", "Old plan"),
          work("00000000-0000-4000-8000-000000000002", "ACTIVE", "Live plan"),
        ]}
      />,
    );
    expect(screen.queryByText("Q is working on")).toBeNull();
    expect(screen.getByText("Plans you approved")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Live plan")).toBeLessThan(text.indexOf("Old plan"));
  });

  it("keeps 'Q is working on' when everything shown is running", () => {
    render(
      <WorkPanel
        variant="page"
        initial={[
          work("00000000-0000-4000-8000-000000000002", "ACTIVE", "Live plan"),
        ]}
      />,
    );
    expect(screen.getByText("Q is working on")).toBeTruthy();
  });
});
