// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

import type { QRehearsalDto } from "@capital-q/contracts";

import { RehearsalReview } from "../src/features/rehearsal/rehearsal-review";

/** REHEARSE (founder live 2026-10-01): the review's transcript shows every line's words. */
const fixture: QRehearsalDto = {
  id: "bc85199e-725c-4173-8b10-467f46eb7393",
  counterpart: {
    kind: "COMPANY",
    id: "0d1c0de0-0000-4000-8000-000000000001",
    name: "Yamfield Agro",
  },
  userRole: "INVESTOR",
  status: "FINISHED",
  outcome: "DECLINED",
  meetingId: null,
  voice: "MALE",
  difficulty: "TOUGH",
  metrics: {
    yourShareOfWords: 40,
    longestAnswerWords: 12,
    exchanges: 1,
    minutes: 3,
  },
  previousScore: null,
  persona: {
    summary: "A founder.",
    style: "Calm.",
    priorities: [],
    grounding: "SOME",
  },
  turns: [
    {
      from: "THEM",
      text: "Hello, thanks for making the time.",
      at: "2026-10-01T14:44:58.757Z",
      mood: "WARM",
      sawScreen: false,
      intensity: "NORMAL",
      reaction: null,
    },
    {
      from: "YOU",
      text: "Hello. Um, how are you?",
      at: "2026-10-01T14:45:14.569Z",
      mood: null,
      sawScreen: false,
    },
  ],
  review: null,
  createdAt: "2026-10-01T14:44:50.000Z",
  endedAt: "2026-10-01T14:48:00.000Z",
};

describe("the review's transcript", () => {
  it("shows who said what, with the words", () => {
    render(<RehearsalReview rehearsal={fixture} />);
    const items = within(
      screen.getByRole("list", { name: "Transcript" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain(
      "Hello, thanks for making the time.",
    );
    expect(items[1]?.textContent).toContain("Hello. Um, how are you?");
  });
});

describe("a provisional review (REHEARSE P0, 2026-10-01)", () => {
  it("says Q is still writing it, shows what code counted, and no score", () => {
    render(
      <RehearsalReview
        rehearsal={{
          ...fixture,
          review: {
            overall:
              "Q will finish your review shortly. So far: you spoke 40% of the words.",
            score: null,
            dimensions: [],
            wentRight: [],
            wentWrong: [],
            tips: [],
            provisional: true,
          },
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Q is still writing the full review",
    );
    expect(screen.getByText(/Q will finish your review shortly/)).toBeTruthy();
    expect(screen.queryByText("/ 100")).toBeNull();
  });
});
