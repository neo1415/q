# REHEARSE — rehearse any meeting with the person you are meeting

Owner: REHEARSE worker (branch `build/rehearse`). Migration prefix `202611110`.
Builds on C12 (Investor Twin): `q_runtime.rehearsals`, INVESTOR_PERSONA /
INVESTOR_TWIN_TURN / REHEARSAL_SCORE v1, `/investors/[id]/rehearse`.

## 1. Goals (founder's words, 2026-10-01)

1. When a meeting is scheduled between connected people, **Q suggests
   rehearsing** (a notification and a mention on Home).
2. A **Rehearsals page** lists the people you are connected to; pick one and
   start. Unlimited rehearsals; history kept.
3. Q **continuously builds a personality profile** of the other person from
   online + Capital Q data (mandate/profile, public presence, comments, chats
   _with this person_, pitch transcripts, deck) so it knows what they will say
   and ask, and **plays them down to the T** — investor or founder.
4. The room **looks and works exactly like Google Meet**: tiles, bottom
   control bar (mic, camera, captions, raise hand, leave), layout, timer;
   optional **screen share that Q reads and questions**.
5. Q **talks like a person by voice** (existing Deepgram/ElevenLabs relay),
   handles interruptions and curve balls, asks and answers, can be angry,
   soft, warm, cold or indifferent as the situation warrants, and keeps going
   to a **natural conclusion**: indecisive, strong chance later, adjourned
   (something missing), deal agreed (and, realistically, a pass).
6. As investor, Q asks from the founder's **pitch transcripts, deck and
   online info**.
7. After each session: a **review with a score**, a breakdown (what went
   right / wrong, how to improve) and **tips specific to that person**.
8. **Smooth, no lags.**

Privacy (founder): a persona never uses the other person's private Q chats or
founder-private data the user is not authorised to see; the room says
plainly "AI rehearsal of X, based on public and shared information". Persona
profiles are stored with provenance; facts go through the Write Gate.

## 2. Research

- **Google Meet (web)** — dark canvas in every theme; participant tiles with
  rounded corners, name bottom-left, muted-mic badge top-right, a speaking
  ring/bars on the active speaker; with two people the other person fills the
  stage and your self-view floats bottom-right. Bottom bar always visible:
  clock and meeting name **bottom-left**; centre **round buttons** in order
  mic, camera, captions, raise hand, present (screen share), more, and a red
  pill **leave** separated at the end; details/people/chat bottom-right.
  Captions sit above the bar with the speaker's name. Mobile: same bar,
  fewer buttons, extras under "more"; raise hand moved into the overflow on
  phones in 2025. Sources: [Google Meet help: call controls](https://support.google.com/meet/answer/10550593),
  [Workspace Updates 2025-02: call control updates](https://workspaceupdates.googleblog.com/2025/02/google-meet-call-control-updates.html),
  [Android Central: Meet redesign](https://www.androidcentral.com/apps-software/google-mixed-things-up-with-its-meet-redesign).
- **kuuza.ai** — practice simulator for high-stakes calls: unlimited
  personas with cultural nuance and emotion, natural speech with
  interruptions, instant scoring on clarity, tone, empathy, objection
  handling, confidence; history and progress. Source: [kuuza.ai](https://kuuza.ai).
  Take: emotion and interruptions, scored dimensions, history. Leave:
  generic personas — ours is _this_ person.
- **Pitch/interview practice** (GrillMyPitch, PitchYourIdea, CodeWords pitch
  simulator, Mentara): deck-driven tough questions, voice VC simulators,
  instant feedback. Sources: [GrillMyPitch](https://dolphinvoice.ai/en/ai-apps/grillmypitch-1077170),
  [CodeWords pitch simulator](https://codewords.ai/templates/pitch-practice-simulator),
  [PitchYourIdea on G2](https://www.g2.com/sellers/pitchyouridea-ai).
  Take: questions grounded in the founder's own deck/pitch; a better answer
  per weak moment.
- **Turn-taking latency** — human median gap between speakers is ~200 ms
  (Stivers et al. 2009); voice agents feel natural under ~800 ms end to end;
  barge-in must be heard while the agent speaks (full duplex) and react in
  <200 ms. Sources: [Picovoice: latency, turn-taking, barge-in](https://picovoice.ai/guide/voice-agents/voice-ux-latency-turn-taking/),
  [Twig: the 800 ms rule](https://www.twig.so/blog/voice-ai-agents-latency-budget-800ms),
  [tianpan.co: turn-taking budget](https://tianpan.co/blog/2026-04-27-voice-agent-turn-taking-latency-budget).
  Consequences here: (1) the persona profile is built **before** the call
  (never in the turn path); (2) each turn is **one** model call with a small
  output (≤ 400 tokens), streamed sentence by sentence to TTS through the
  existing think route; (3) Deepgram Flux end-of-turn + think abort handle
  barge-in (already full duplex); (4) the browser shows "thinking" in the
  tile, never a spinner over the stage.

## 3. UX flows

1. **Meeting scheduled** → every Capital Q participant gets a notification
   "Rehearse your call with X" (`MEETING_PREP_READY`, link
   `/rehearsals/meeting/<meetingId>`), and Home's briefing shows "Rehearse
   before your call with X" for meetings in the next 7 days.
2. **/rehearsals** — "Upcoming calls" (rehearse button per call), "People
   you're connected to" (founder: investors; investor: companies; each with
   last rehearsal score), "History" (every past rehearsal → review).
3. **Lobby** (`/rehearsals/investor/<id>` or `/rehearsals/company/<id>`,
   or `/rehearsals/meeting/<meetingId>` which resolves to one of those):
   Meet's green-room: self-preview (camera optional), the person's tile,
   "AI rehearsal of X, based on public and shared information", what Q
   knows (grounding THIN/SOME/RICH, sources list), voice choice for their
   voice, **Join now**. The persona profile builds/refreshes here (cached;
   only rebuilt when signals changed).
4. **Room** (Meet layout, stage tokens, dark in both themes like Meet): the
   other person's tile fills the stage with avatar initials and a speaking
   ring driven by output level; self-view tile bottom-right (camera stream
   stays in the browser, never uploaded); captions overlay above the bar;
   bottom bar: left = clock · "Rehearsal with X" · elapsed timer; centre =
   mic, camera, captions, raise hand, present (where supported), layout,
   leave (red pill); right = transcript panel toggle. Phone: tiles stack,
   layout + present move into a "more" sheet.
   - Voice by default; if voice fails, a typed composer in the transcript
     panel (same turns).
   - **Raise hand**: the persona stops and yields ("Go ahead."), the hand
     lowers when you speak.
   - **Present**: `getDisplayMedia`; a frame is captured every 6 s, compared
     with the last (downscaled hash) and only a changed frame (JPEG, ≤1280 px,
     ≤ 350 KB) is posted; the next persona turn sees it and questions it.
     Frames are never stored; a "Q can see your screen" chip shows while
     sharing. Hidden where `getDisplayMedia` is missing (phones).
   - **Leave** = end; the persona's own close (move CLOSE) also ends it.
5. **Review** (`/rehearsals/r/<rehearsalId>`): outcome ("Strong chance
   later", …), score /100, five rated dimensions, what went right, what went
   wrong + a better answer, tips for this person, the full transcript;
   "Rehearse again".

## 4. Data model (migration `20261111000000_q_runtime_rehearse.sql`)

- `q_runtime.persona_profiles` — one per (viewer, subject): tenant_id,
  viewer_user_id, subject_kind (`INVESTOR_ORGANISATION`|`COMPANY`),
  subject_id, subject_name, relationship_id, `profile` jsonb (Q's reading),
  `sources` jsonb `[{kind,label,ref,at}]` (provenance), `signal_digest`
  (hash of the material read), `web_read_at`, `truth_class` fixed
  `Q_INFERENCE`, version, built_at/refreshed_at. Unique (viewer_user_id,
  subject_kind, subject_id). RLS: select own (user + tenant member);
  server-written only.
- `q_runtime.rehearsals` (additive): counterpart_kind, counterpart_id,
  counterpart_name (backfilled from the investor columns, which become
  nullable), relationship_id, meeting_id, persona_profile_id, user_role
  (`FOUNDER`|`INVESTOR`), voice, outcome, score (0–100, code-computed),
  ended_at; turn limit raised (turns kept ≤ 160); `asked` max raised to 80.
- Notifications reuse kind `MEETING_PREP_READY` (no constraint churn with
  other workers' migrations).

## 5. Contracts (packages/contracts/src/q/rehearsals.ts)

- `POST /v1/q/rehearsals` `{counterpart:{kind,id} | investorOrganisationId,
meetingId?, voice?}` → `QRehearsalDto`.
- `GET /v1/q/rehearsals` → history (≤ 50, newest first).
- `GET /v1/q/rehearsals/partners` → upcoming calls + connected people.
- `GET /v1/q/rehearsals/persona/:kind/:id` → the persona (profile summary,
  grounding, sources) for the lobby; builds or refreshes it.
- `GET /v1/q/rehearsals/meetings/:meetingId` → which counterpart a meeting
  is with (for `/rehearsals/meeting/<id>`).
- `GET|POST /v1/q/rehearsals/:id`, `/turns` (`{text}` or `{cue:"HAND_RAISED"}`),
  `/finish`, `/screen` (`{image}` jpeg data URL, ≤ 480 KB).
- Voice: `CreateQVoiceSessionRequest.rehearsal = {rehearsalId}` (optional,
  strict). The think route routes that line's turns to the rehearsal.
- Model gateway: USER messages may carry `images` (≤ 2, jpeg/png/webp
  base64); a request with images requires `VISION`. OpenAI/Google/Groq
  adapters map it; the fake ignores it.

## 6. Prompts (versioned, old DEPRECATED)

- INVESTOR_PERSONA **v2** — the counterpart (investor _or_ founder) for this
  viewer: summary, style, temperament (how they react: warm/cold/impatient
  triggers), priorities, likelyQuestions, likelyAnswers (for a founder
  persona: how they answer the hard questions), pushbacks, howToWin,
  dealbreakers, grounding; incremental (given the previous profile).
- INVESTOR_TWIN_TURN **v2** — plays either side; mood per line
  (WARM, NEUTRAL, SKEPTICAL, IMPATIENT, ANNOYED, ENTHUSIASTIC, COLD,
  INDIFFERENT); moves QUESTION / FOLLOW_UP / ANSWER / REMARK / YIELD / CLOSE;
  outcome on CLOSE (INDECISIVE, STRONG_LATER, ADJOURNED, DEAL_AGREED,
  DECLINED); a shared-screen frame when present; curve balls; spoken style.
- REHEARSAL_SCORE **v2** — role-aware dimensions, wentRight, wentWrong
  (+better), tips for this person, outcome read. **Score** = deterministic
  mean of the ratings (STRONG 90, SOLID 70, NEEDS_WORK 40), never a number
  the model invents.

## 7. Q tools + capability registry (`// REHEARSE block`)

- `open_page` pages `INVESTOR_REHEARSAL` (existing; now `/rehearsals/investor/<id>`)
  and new `COMPANY_REHEARSAL` (investor rehearsing with a company they have
  a relationship with). "Rehearse my meeting with X" by text or voice from
  any Q resolves X by name over their own relationships.
- `navigate` destination `REHEARSALS` (the list).
- `list_my_rehearsals` (read): their past rehearsals with outcome and score.
- Authority: all INSTANT (own practice, own screens). Nothing in a
  rehearsal writes a claim, memory, relationship event or message; nothing
  reaches the other person.

## 8. Context Firewall and privacy

Material per side, all resolved **before** any model call, for the viewer:

| Viewer   | Counterpart  | Material                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder  | Investor org | Discover/relationship view (declared, network-visible: type, country, deployment, own words, state with this founder); their messages to this founder; their words in calls this founder was on; public web snippets about the firm (one search, ≤ weekly); the founder's **own** company profile, own pitch transcripts, own Q-made deck (to ask about) |
| Investor | Company      | Company profile as Discover shows it to them; pitch transcripts **only** under the playback rule (`getPitchTranscript`); the founder side's messages to this investor; calls this investor was on; company knowledge with `network_visible`/`public_external` scope only; public web snippets                                                            |

Never: the other person's Q chats, mandate internals not shown to the
viewer, founder-private knowledge, the other side's private notes. A persona
is `Q_INFERENCE` about style, stored with sources; it writes nothing to
Knowledge (no facts are persisted, so the Write Gate is not bypassed).
Screen frames go only to a vision-capable model through the gateway and are
never stored. Label on lobby, room and review: "AI rehearsal of X, based on
public and shared information."

## 9. Failure, edge cases, states

- Persona build fails → lobby error with Try again; an existing profile is
  used while a refresh fails. THIN grounding is said plainly.
- Voice unavailable (no provider/mic denied) → room stays, typed composer,
  persona lines still shown as captions.
- Turn fails → persona says "Sorry, say that again?" (in character) — never
  a dead line; think deadline 20 s.
- Interruption → think aborted; nothing persisted for the aborted reply; the
  grown utterance is answered.
- Leave before any answer → no review; rehearsal marked FINISHED with
  outcome LEFT_EARLY and no score.
- No connections → empty state pointing to Discover.
- Counterpart no longer visible → 404 lobby, same as never visible.
- Loading: skeleton tiles; lobby "Q is reading up on X…".

## 10. Tests and live checks

- vitest: service (start/turn/hand/finish/score, firewall: no material for
  unseen counterpart, persona reuse when digest unchanged, rebuild when
  changed), think routing for rehearsal lines, gateway image mapping per
  provider, contracts; prompts lock; route-capability parity; web pure
  helpers (frame change detection, timer format).
- pgTAP `supabase/tests/rehearse_persona_profiles.test.sql`: own read,
  cross-tenant/other-user denied, revoked grant denied, writes denied.
- Live (after deploy, fictional accounts): founder rehearses with a
  connected investor by voice to a CLOSE; investor rehearses with a company;
  booking a call creates the suggestion; screen share question.
