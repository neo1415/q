// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OnboardingSuggestionViewSchema,
  type OnboardingSuggestionView,
} from "@capital-q/contracts";

import type { VoiceSessionClient } from "../src/features/voice/session";

/**
 * Voice onboarding, conversation first (owner 2026-10-27):
 * - "Continue later" is in the voice too, for an onboarding call only;
 * - a document's reading reaches the live call as a quiet note, not a tap;
 * - the reading shows as a document card whose skeleton resolves into
 *   what was found.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { VoiceStage } = await import("../src/features/voice/voice-stage");
const { DocumentReadingCard } =
  await import("../src/features/voice/document-reading-card");
const {
  findingsFromDocument,
  findingsNotFromDocuments,
  publicFindingsNote,
  uploadFindingsNote,
} = await import("../src/features/onboarding-conversation/conversation");
const { useContinueLater, CONTINUE_LATER_PAUSE_MS } =
  await import("../src/features/onboarding-kit/components/continue-later");

function client(): VoiceSessionClient {
  return {
    state: "LISTENING",
    connected: true,
    muted: false,
    transcript: [],
    start: vi.fn(() => Promise.resolve()),
    end: vi.fn(() => Promise.resolve()),
    sendText: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    inputLevel: () => 0,
    outputLevel: () => 0,
  };
}

function renderStage(extra: Partial<Parameters<typeof VoiceStage>[0]> = {}) {
  return render(
    <VoiceStage
      client={client()}
      voice="FEMALE"
      voices={["FEMALE"]}
      onChooseVoice={vi.fn()}
      onEnd={vi.fn()}
      notice={null}
      onDismissNotice={vi.fn()}
      asking={null}
      onSay={vi.fn()}
      onUseForm={undefined}
      progress={[]}
      {...extra}
    />,
  );
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Continue later on the voice stage", () => {
  it("is not offered on a voice stage that is not onboarding", () => {
    renderStage();
    expect(screen.queryByRole("button", { name: "Continue later" })).toBe(null);
  });

  it("is a labelled, 44 px control on an onboarding call and calls its handler", () => {
    const onContinueLater = vi.fn();
    renderStage({ onContinueLater });
    const button = screen.getByRole("button", { name: "Continue later" });
    expect(button.className).toContain("min-h-11");
    button.click();
    expect(onContinueLater).toHaveBeenCalledTimes(1);
  });

  it("ends the call before Home opens, after the reassurance pause, once", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const end = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    function Leave() {
      const { leaving, leave } = useContinueLater();
      return (
        <button type="button" onClick={() => leave(end)}>
          {leaving ? "leaving" : "stay"}
        </button>
      );
    }
    render(<Leave />);
    act(() => {
      screen.getByRole("button").click();
      screen.getByRole("button").click();
    });
    expect(end).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").textContent).toBe("leaving");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTINUE_LATER_PAUSE_MS);
    });
    // The pause is over but the call has not finished sending: wait.
    expect(push).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/home");
  });
});

describe("the note a live call gets when a reading lands", () => {
  it("lists what was found, unconfirmed, and asks Q not to ask again", () => {
    expect(
      uploadFindingsNote("Deck v3.pdf", "FOUND", [
        { label: "Stage", value: "Seed" },
        { label: "Sector", value: "Climate software" },
      ]),
    ).toBe(
      "The person just uploaded \"Deck v3.pdf\". Q read it and found: Stage: Seed; Sector: Climate software (not confirmed yet). Don't ask them for these again; when it fits, say briefly what you found and ask if it's right.",
    );
  });

  it("says plainly when the reading found nothing new", () => {
    expect(uploadFindingsNote("Deck v3.pdf", "NOTHING_NEW", [])).toBe(
      'The person just uploaded "Deck v3.pdf"; Q read it and found nothing new for their setup.',
    );
  });

  it("keeps a quote in the file name from closing the quoted name", () => {
    expect(uploadFindingsNote('a"b.pdf', "NOTHING_NEW", [])).toContain(
      `"a'b.pdf"`,
    );
  });

  it("takes only the findings that cite this document", () => {
    const suggestion = (
      n: number,
      sourceId: string,
    ): OnboardingSuggestionView =>
      OnboardingSuggestionViewSchema.parse({
        id: `00000000-0000-4000-8000-00000000000${String(n)}`,
        stepKey: "stage",
        targetField: "stage",
        suggestedValue: { type: "SINGLE_SELECT", optionKey: "seed" },
        confidence: null,
        status: "PENDING",
        createdAt: "2026-10-27T00:00:00.000Z",
        sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT", sourceId }],
        rationale: null,
      });
    const items = [
      {
        suggestion: suggestion(1, "doc-a"),
        label: "Stage",
        value: "Seed",
        editorId: undefined,
      },
      {
        suggestion: suggestion(2, "doc-b"),
        label: "Sector",
        value: "Fintech",
        editorId: undefined,
      },
    ];
    expect(findingsFromDocument(items, "doc-a")).toEqual([
      { label: "Stage", value: "Seed" },
    ]);
  });
});

describe("research on them reaches the live call (owner 2026-10-27)", () => {
  it("tells Q what public sources gave, unconfirmed, and never a document's findings twice", () => {
    const suggestion = (
      n: number,
      sourceRefs: readonly { sourceType: string; sourceId: string }[],
    ): OnboardingSuggestionView =>
      OnboardingSuggestionViewSchema.parse({
        id: `00000000-0000-4000-8000-00000000000${String(n)}`,
        stepKey: "I0.website",
        targetField: "website",
        suggestedValue: { type: "TEXT", text: "https://vaultlyne.com" },
        confidence: null,
        status: "PENDING",
        createdAt: "2026-10-27T00:00:00.000Z",
        sourceRefs,
        rationale: null,
      });
    const items = [
      {
        suggestion: suggestion(1, [
          { sourceType: "PUBLIC_WEB", sourceId: "https://vaultlyne.com" },
        ]),
        label: "Website",
        value: "vaultlyne.com",
        editorId: undefined,
      },
      {
        suggestion: suggestion(2, [
          { sourceType: "EVIDENCE_DOCUMENT", sourceId: "doc-a" },
        ]),
        label: "Stage",
        value: "Seed",
        editorId: undefined,
      },
    ];
    const found = findingsNotFromDocuments(items);
    expect(found).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        label: "Website",
        value: "vaultlyne.com",
      },
    ]);
    expect(publicFindingsNote(found)).toBe(
      "Capital Q found this about them from public sources (not confirmed yet): Website: vaultlyne.com. Don't ask them for these again; when it fits naturally, mention it briefly and ask if it's right.",
    );
  });
});

describe("the document reading card", () => {
  it("shows the file, the stage and a moving skeleton while uploading and reading", () => {
    const { rerender } = render(
      <DocumentReadingCard
        fileName="Deck.pdf"
        stage="UPLOADING"
        reducedMotion={false}
      />,
    );
    expect(screen.getByText("Deck.pdf")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Uploading");
    const skeleton = document.querySelector("[data-document-reading-skeleton]");
    expect(skeleton?.getAttribute("data-document-reading-skeleton")).toBe(
      "moving",
    );
    expect(document.querySelectorAll("[data-skeleton-line]").length).toBe(4);
    expect(document.querySelector("[data-skeleton-line]")?.className).toContain(
      "cq-skeleton",
    );

    rerender(
      <DocumentReadingCard
        fileName="Deck.pdf"
        stage="READING"
        reducedMotion={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Reading");
  });

  it("keeps the skeleton still for reduced motion", () => {
    render(
      <DocumentReadingCard fileName="Deck.pdf" stage="READING" reducedMotion />,
    );
    expect(
      document
        .querySelector("[data-document-reading-skeleton]")
        ?.getAttribute("data-document-reading-skeleton"),
    ).toBe("still");
    for (const line of document.querySelectorAll("[data-skeleton-line]")) {
      expect(line.className).not.toContain("cq-skeleton");
    }
  });

  it("resolves into what was found, in the same fixed-height body", () => {
    render(
      <DocumentReadingCard
        fileName="Deck.pdf"
        stage="DONE"
        found={[
          { label: "Stage", value: "Seed" },
          { label: "Sector", value: "Climate" },
        ]}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Done");
    expect(document.querySelector("[data-document-reading-skeleton]")).toBe(
      null,
    );
    expect(screen.getByText("Seed")).toBeTruthy();
    expect(
      document.querySelector("[data-document-reading-body]")?.className,
    ).toContain("h-20");
  });

  it("says nothing new when the reading added nothing", () => {
    render(<DocumentReadingCard fileName="Deck.pdf" stage="NOTHING_NEW" />);
    expect(screen.getByRole("status").textContent).toBe("Nothing new");
    expect(screen.getByText("Nothing new for your setup.")).toBeTruthy();
  });

  it("is shown on the voice stage in place of the plain upload line", () => {
    renderStage({
      uploadNote: "Reading Deck.pdf",
      uploadCard: { fileName: "Deck.pdf", stage: "READING" },
    });
    expect(document.querySelector("[data-document-reading]")).not.toBe(null);
    expect(screen.queryByText("Reading Deck.pdf")).toBe(null);
  });
});
