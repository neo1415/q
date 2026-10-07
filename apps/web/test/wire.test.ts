// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import * as contracts from "@capital-q/contracts";

import {
  performClientAction,
  type ClientActionEffects,
} from "../src/features/q/client-actions";
import { roomStage } from "../src/features/q/room/room-stage";
import { loadWire, wireNow } from "../src/features/q/wire";
import {
  conversationIdOf,
  GOOGLE_RECONNECT_PATH,
  isUuid,
  qArtifactExportFormats,
  Q_CONFIDENCE_LABELS,
  Q_MANIFEST_DIALOGS_MAX,
  Q_MANIFEST_DIALOG_REFS_MAX,
  Q_MANIFEST_SECTIONS_MAX,
  Q_MANIFEST_SECTION_REFS_MAX,
  Q_SPEECH_MAX_CHARS,
  Q_VOICE_LISTENING_DEFAULT,
  Q_VOICE_LISTENING_LEVELS,
} from "../src/features/q/wire-constants";

/**
 * Q room W7: the wire's contracts load after the first paint. Before they
 * are in, nothing is shown or done unchecked; once they are, what waited
 * is checked and done. The plain values the first paint needs are copies,
 * held equal to their contracts here.
 */

function effects(done: string[]): ClientActionEffects {
  return {
    setTheme: (theme) => done.push(`theme:${theme}`),
    reload: () => done.push("reload"),
    openTab: (url) => {
      done.push(`open:${url}`);
      return true;
    },
    setQMotion: () => undefined,
    setVoice: () => undefined,
    signOut: () => undefined,
    goTo: (path) => done.push(`go:${path}`),
    setDiscoverFilters: () => undefined,
    screen: () => undefined,
    openMaterial: () => undefined,
  };
}

const SHOWN = {
  kind: "Q" as const,
  id: "a1",
  text: "Here it is.",
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  blocks: [
    {
      kind: "UI_INTENT" as const,
      intent: {
        kind: "SHOW_IN_Q_ROOM" as const,
        object: "DATA_ROOM" as const,
        id: "00000000-0000-4000-8000-000000000001",
        title: "Ledgerline",
      },
    },
  ],
};

describe("the wire's contracts, off the first paint (W7)", () => {
  // Order matters: these run before anything loads the contracts.
  it("before they are in: no card is shown, and an action waits, unchecked and undone", async () => {
    expect(wireNow()).toBeNull();
    expect(roomStage([SHOWN as never]).open).toBeNull();
    const done: string[] = [];
    expect(
      performClientAction(
        { kind: "OPEN_WEBSITE", url: "javascript:alert(1)" },
        effects(done),
      ),
    ).toBe(true);
    expect(
      performClientAction({ kind: "SET_THEME", theme: "dark" }, effects(done)),
    ).toBe(true);
    expect(done).toEqual([]);
    // Once they are in: checked, then done -- the script URL never.
    await loadWire();
    await vi.waitFor(() => expect(done).toEqual(["theme:dark"]));
  });

  it("once they are in, the card the answer carries is shown", () => {
    expect(wireNow()).not.toBeNull();
    expect(roomStage([SHOWN as never]).open?.intent.title).toBe("Ledgerline");
  });

  it("keeps each copied value equal to its contract", () => {
    expect(GOOGLE_RECONNECT_PATH).toBe(contracts.GOOGLE_RECONNECT_PATH);
    expect(Q_SPEECH_MAX_CHARS).toBe(contracts.Q_SPEECH_MAX_CHARS);
    expect(Q_CONFIDENCE_LABELS).toEqual(contracts.Q_CONFIDENCE_LABELS);
    for (const type of [...contracts.Q_ARTIFACT_TYPES, "UNKNOWN_TYPE"]) {
      expect(qArtifactExportFormats(type), type).toEqual(
        contracts.qArtifactExportFormats(type),
      );
    }
    expect(Q_MANIFEST_SECTIONS_MAX).toBe(contracts.Q_MANIFEST_SECTIONS_MAX);
    expect(Q_MANIFEST_SECTION_REFS_MAX).toBe(
      contracts.Q_MANIFEST_SECTION_REFS_MAX,
    );
    expect(Q_MANIFEST_DIALOGS_MAX).toBe(contracts.Q_MANIFEST_DIALOGS_MAX);
    expect(Q_MANIFEST_DIALOG_REFS_MAX).toBe(
      contracts.Q_MANIFEST_DIALOG_REFS_MAX,
    );
    expect([...Q_VOICE_LISTENING_LEVELS]).toEqual([
      ...contracts.Q_VOICE_LISTENING_LEVELS,
    ]);
    expect(Q_VOICE_LISTENING_DEFAULT).toBe(contracts.Q_VOICE_LISTENING_DEFAULT);
  });

  it("reads an id exactly as the contracts' UUID check does", () => {
    const samples = [
      "00000000-0000-4000-8000-000000000001",
      "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "00000000-0000-9000-8000-000000000001",
      "00000000-0000-4000-c000-000000000001",
      "00000000-0000-4000-8000-00000000000",
      " 00000000-0000-4000-8000-000000000001",
      "not-an-id",
      "",
      42,
      null,
      undefined,
    ];
    for (const sample of samples) {
      const expected =
        contracts.QConversationIdSchema.safeParse(sample).success;
      expect(isUuid(sample), String(sample)).toBe(expected);
      expect(conversationIdOf(sample) !== undefined).toBe(expected);
    }
  });
});
