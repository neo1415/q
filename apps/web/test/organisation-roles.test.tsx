// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActivityPageDto, TeamRole } from "@capital-q/contracts";

const activityAction = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/features/organisation/activity-actions", () => ({
  activityAction: (...args: unknown[]) => activityAction(...args) as unknown,
}));
vi.mock("@/features/profile/profile-actions", () => ({}));
vi.mock("@/features/team/team-actions", () => ({}));

import {
  activityItems,
  activityPage,
  capabilitiesAs,
  teamAs,
} from "../app/dev/org-review/fixtures";
import { ActivityFeed } from "../src/features/organisation/activity-feed";
import { ActivityPageView } from "../src/features/organisation/admin-pages";
import { CapabilitiesProvider } from "../src/features/organisation/capabilities";
import { RoleCard } from "../src/features/organisation/role-card";
import {
  CAP,
  gateOf,
  roleLines,
} from "../src/features/organisation/role-words";
import { EditableSection } from "../src/features/profile/editable-section";
import { INVESTOR_FIELDS } from "../src/features/profile/profile-fields";
import { TeamPage } from "../src/features/team/team-page";

afterEach(() => {
  cleanup();
  activityAction.mockReset();
});

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const t = (english: string) => english;

function asRole(role: TeamRole, node: React.ReactNode) {
  return render(
    <CapabilitiesProvider value={capabilitiesAs(role)}>
      {node}
    </CapabilitiesProvider>,
  );
}

function firmSection() {
  return (
    <EditableSection
      id="firm"
      variant="brief"
      title="Your firm"
      capability={CAP.INVESTOR_EDIT}
      profile={{
        kind: "INVESTOR_ORGANISATION",
        subjectId: "00000000-0000-4000-8000-0000000000b1",
        fields: INVESTOR_FIELDS.filter((spec) => spec.field === "displayName"),
        values: { displayName: "Harbourline Capital (fictional)" },
        version: 1,
        provenance: "Your statement · self-reported",
      }}
    />
  );
}

describe("role-aware controls (capabilities from the DTO, never role strings)", () => {
  it("holds an admin-only Edit back for a member, with the reason", () => {
    asRole("MEMBER", firmSection());
    expect(screen.queryByRole("button", { name: /Edit Your firm/ })).toBeNull();
    const locked = document.querySelector("[data-gated-control]");
    expect(locked?.textContent).toContain("Admins only");
    expect(locked?.textContent).toContain(
      "Only admins can edit the firm's profile.",
    );
  });

  it("shows Edit to an admin", () => {
    asRole("ADMIN", firmSection());
    expect(screen.getByRole("button", { name: "Edit Your firm" })).toBeTruthy();
    expect(document.querySelector("[data-gated-control]")).toBeNull();
  });

  it("leaves a control to the server when capabilities are unknown", () => {
    render(firmSection());
    expect(screen.getByRole("button", { name: "Edit Your firm" })).toBeTruthy();
    expect(gateOf(null, CAP.INVESTOR_EDIT).allowed).toBe(true);
  });

  it("links each person on Team to their page only for admins and owners", () => {
    asRole("ADMIN", <TeamPage initial={teamAs("ADMIN", NOW)} />);
    expect(
      document.querySelectorAll("[data-team-member-link]").length,
    ).toBeGreaterThan(0);
    cleanup();
    asRole("MEMBER", <TeamPage initial={teamAs("MEMBER", NOW)} />);
    expect(document.querySelectorAll("[data-team-member-link]").length).toBe(0);
  });

  it("explains each role in plain words, from what it holds", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      asRole(role, <RoleCard team={teamAs(role, NOW)} />);
      const card = document.querySelector(`[data-role-card="${role}"]`);
      expect(card).toBeTruthy();
      const activityLink = document.querySelector("[data-role-activity-link]");
      if (role === "MEMBER") {
        expect(activityLink).toBeNull();
        expect(
          document.querySelector("[data-role-cannot]")?.textContent,
        ).toContain("Change the mandate");
        expect(
          document.querySelector("[data-role-admins]")?.textContent,
        ).toContain("Jonah Pryce");
      } else {
        expect(activityLink?.getAttribute("href")).toBe("/settings/activity");
      }
      if (role === "OWNER") {
        expect(document.querySelector("[data-role-cannot]")).toBeNull();
      }
      if (role === "ADMIN") {
        expect(document.querySelector("[data-role-cannot]")?.textContent).toBe(
          "Hand over ownership",
        );
      }
      cleanup();
    }
    expect(
      roleLines(capabilitiesAs("MEMBER").capabilities, "FIRM").can,
    ).toEqual(["Approve what Q sends for you", "Upload documents"]);
  });
});

describe("the activity feed", () => {
  const page: ActivityPageDto = {
    items: activityItems(NOW),
    nextCursor: "cmV2aWV3LWN1cnNvcg",
  };

  it("shows Q under a person's approval, and before → after", () => {
    render(<ActivityFeed initial={page} people={[]} />);
    const q = document.querySelectorAll('[data-activity-item="Q"]');
    expect(q.length).toBe(2);
    expect(q[0]?.textContent).toContain("Q, under Jonah Pryce's approval");
    const change = document.querySelector("[data-activity-change]");
    expect(change?.textContent).toContain("Member");
    expect(change?.textContent).toContain("Admin");
    // An outcome other than success is said in words.
    const denied = document.querySelector('[data-activity-outcome="DENIED"]');
    expect(denied?.textContent).toContain("Not allowed");
    const failed = document.querySelector('[data-activity-outcome="FAILED"]');
    expect(failed?.textContent).toContain("Didn't go through");
    // A resource with a link is a link.
    expect(
      screen.getByRole("link", { name: "Kestrel Grid (fictional)" }),
    ).toBeTruthy();
  });

  it('follows the cursor on "Show more" (never an offset) and appends', async () => {
    const extra = activityItems(NOW - 30 * 86_400_000).map((entry, n) => ({
      ...entry,
      id: `00000000-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`,
    }));
    activityAction.mockResolvedValue({
      ok: true,
      value: { items: extra.slice(0, 2), nextCursor: null },
    });
    render(<ActivityFeed initial={page} people={[]} />);
    const before = document.querySelectorAll("[data-activity-item]").length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await Promise.resolve();
    });
    expect(activityAction).toHaveBeenCalledTimes(1);
    const query = activityAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(query["cursor"]).toBe("cmV2aWV3LWN1cnNvcg");
    expect(query).not.toHaveProperty("offset");
    expect(document.querySelectorAll("[data-activity-item]").length).toBe(
      before + 2,
    );
    expect(screen.getByText("That's everything.")).toBeTruthy();
  });

  it("says when filters match nothing, and when there is nothing at all", () => {
    render(
      <ActivityFeed
        initial={{ items: [], nextCursor: null }}
        people={[]}
        filters={{ kind: "TEAM" }}
      />,
    );
    expect(
      document.querySelector('[data-activity-state="filtered-empty"]'),
    ).toBeTruthy();
    cleanup();
    render(<ActivityFeed initial={activityPage(NOW, "empty")} people={[]} />);
    expect(
      document.querySelector('[data-activity-state="empty"]'),
    ).toBeTruthy();
    cleanup();
    render(<ActivityFeed initial={null} people={[]} />);
    expect(
      document.querySelector('[data-activity-state="error"]'),
    ).toBeTruthy();
  });
});

describe("a member is refused, honestly", () => {
  it("renders the server's 403 as 'Only admins and owners see this'", () => {
    render(
      <ActivityPageView
        t={t}
        organisationName="Harbourline Capital (fictional)"
        activity={{ status: "DENIED", role: "MEMBER" }}
        people={[]}
      />,
    );
    const denied = document.querySelector("[data-org-denied]");
    expect(denied).toBeTruthy();
    expect(
      within(denied as HTMLElement).getByRole("heading", {
        name: "Only admins and owners see this",
      }),
    ).toBeTruthy();
    expect(denied?.textContent).toContain("You're a Member.");
    expect(document.querySelector("[data-activity-feed]")).toBeNull();
  });

  it("stops the feed when a later read is refused", async () => {
    activityAction.mockResolvedValue({
      ok: false,
      denied: true,
      message: "Only admins and owners see this.",
    });
    render(
      <ActivityFeed
        initial={{ items: activityItems(NOW), nextCursor: "next" }}
        people={[]}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Only admins and owners see this.",
    );
    expect(document.querySelector("[data-activity-list]")).toBeNull();
  });
});
