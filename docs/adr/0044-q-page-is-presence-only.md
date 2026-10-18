# ADR 0044: The Q page is Q's presence; text and objects only when shown

- Status: Accepted (founder decision, 2026-10-03)
- Amends: ADR 0017 F3 ("a voice-first stage with an ambient transcript of
  the live exchange only") and `docs/design/ux-direction-2026-09.md` §7
  ("ambient transcript: current exchange only", "a caption, not a log")
- Implemented: `b5838dcc` (build/qa-13)

## Context

ADR 0017 F3 made the Q page a Stage + Board rather than a chat: a
voice-first stage with an ambient transcript of the current exchange, and
the full thread as a secondary view. In practice the presence view showed
the person's last question and Q's whole answer under the Aperture, and a
laid-out answer (cards, a document) moved Q to the corner and showed the
thread. The page read as a chat with a large logo.

The founder directed (2026-10-03): the Q page shows only Q's presence,
except when Q needs to show something (a PDF, a card, a document). That
appears, then disappears after a few turns and the page is full presence
again. Something shown earlier can be brought back: by asking Q, or from a
side list ("Shown recently"). Chat keeps the full transcript.

## Decision

1. **Presence view: no written exchange.** The presence view renders the
   Aperture and no transcript: no bubbles, no answer text. Q's latest words
   reach assistive technology through a visually hidden `aria-live` region,
   so the spoken answer is never lost to a screen reader.
2. **Captions are an accessibility setting, off by default.** A
   "Captions" toggle on the presence view shows the current exchange as
   ADR 0017's ambient transcript did. The choice is per viewer
   (`localStorage["cq.q.captions"]`), like the view choice.
3. **Objects are shown, then step back.** An answer that carries a
   document (ARTIFACT_REFERENCE, including PDFs), a comparison, comparison
   cards or a question back appears over the presence and steps back after
   three further answers (`SHOWN_FOR_ANSWERS`), or when dismissed. The
   presence no longer moves to the corner for a laid-out answer in this
   view.
4. **A change waiting for approval never steps back.** The pending
   approval (Now / Needs you) stays on the presence view until it is
   approved or declined. Auto-dismissal applies only to objects that need
   no decision.
5. **"Shown recently".** The objects shown in the session (up to eight,
   newest first) are listed under the stage and reopen in place. Q showing
   an object again needs no new mechanism: a later answer carrying the same
   object is shown again.
6. **Chat is unchanged.** The Chat view keeps the full transcript, and the
   transcript download stays. Chat remains the accessible linear
   equivalent ADR 0017 F3 required.

## Consequences

- ADR 0017 F3's "ambient transcript" now applies only when the person
  turns captions on. The Board, the Dock (F1), the Aperture (F2) and the
  theme switcher (F4) are unchanged.
- WCAG: the information is still available as text, in Chat, through
  captions and through the live region. Removing visible text from the
  default view relies on those remaining available and reachable by
  keyboard. The captions and "Shown recently" controls are buttons with
  `aria-pressed` and `aria-expanded`.
- The rule lives in `apps/web/src/features/q/shown.ts`, a pure module, and
  `q-presence-stage.tsx`. Tests: `apps/web/test/q-presence-stage.test.tsx`.
- Open: whether captions should default on for people who use voice with
  a screen reader or reduced-motion preference. Today they are off for
  everyone, and the live region covers screen readers.

## Amendment (Q room W2, founder clarification 2026-10-06)

A card Q brings into the room with the `show` tool (`SHOW_IN_Q_ROOM`) stays only while the conversation is on its subject, not for `SHOWN_FOR_ANSWERS`. Code decides from the turns (`apps/web/src/features/q/room/room-stage.ts`): a new subject closes it at once with a quiet "Closed … as we moved on"; the subject coming back reopens it; "close it" closes it. Answer cards and other shown objects keep the rule above. A document being read stays while the conversation is on that document (the R3 document work, not this amendment).
