import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner rehearsal of Zino Aviation, production a9be2ffc6, 9 Nov. Video fell
 * back to voice (POST /video 200, GET /video 404 at 08:44:28). The lobby
 * showed its own voice room AND navigated to /rehearsals/live, which
 * mounted a second room. q-api logs show two voice sessions 2 s apart
 * (08:44:29, 08:44:31). The second took the person's line, so the first
 * got 401 NO_BINDING_FOR_TOKEN on speak and 404 on its card ("Voice isn't
 * available right now"). The two rooms (each a fixed full-screen stage)
 * overlapped: captions and the avatar over the transcript.
 */

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), "utf8");

const lobby = read("../src/features/rehearsal/rehearsal-lobby.tsx");
const room = read("../src/features/rehearsal/rehearsal-room.tsx");

describe("one rehearsal, one room", () => {
  it("the lobby shows the room it started and only rewrites the URL, never navigating to a second room", () => {
    expect(lobby).not.toContain("router.replace(voicePath)");
    expect(lobby).not.toContain("router.replace(livePath)");
    // A refresh still lands on the same rehearsal.
    expect(lobby).toContain('window.history.replaceState(null, "", voicePath)');
    expect(lobby).toContain('window.history.replaceState(null, "", livePath)');
  });

  it("a room that is gone never opens a voice line", () => {
    const connect = room.slice(
      room.indexOf("const started = await startVoiceSessionAction"),
    );
    expect(connect.slice(0, 900)).toContain(
      "if (!mounted.current) return false;",
    );
  });
});

describe("captions never sit over an open transcript", () => {
  it("the caption overlay hides below md while the transcript sheet is open", () => {
    const overlay = room.slice(
      room.indexOf("(captionsOn && caption !== null) || waiting"),
    );
    expect(overlay.slice(0, 400)).toContain('panel ? " max-md:hidden"');
  });
});

/**
 * (1) "When it's time for review it keeps glitching": after the meeting
 * ended at 08:45:53, q-api logs show GET rehearsal, GET video and POST
 * voice/sessions 404 every ~2 s. Since 1ca6b9346 (13 Oct), the review page
 * never finishes an open rehearsal and sends an ACTIVE one back to the
 * live page. The room's leave() never finished it either, so review →
 * live → (ended) leave → review, forever, and each live mount opened a voice
 * line on an ended rehearsal (404: "Voice isn't available right now").
 */
describe("leaving finishes the rehearsal before the review", () => {
  it("leave() asks the server to finish, and only then goes to the review", () => {
    const leave = room.slice(room.indexOf("const leave = useCallback("));
    const finish = leave.indexOf("await finishRehearsalAction(initial.id)");
    const push = leave.indexOf("router.push(`/rehearsals/r/");
    expect(finish).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(finish);
  });

  it("a room opened on a rehearsal that has already ended opens no voice line", () => {
    const opening = room.slice(room.indexOf("const opened = useRef(false);"));
    expect(opening.slice(0, 500)).toContain(
      'if (initial.endedAt !== null || initial.status === "FINISHED") return;',
    );
  });
});
