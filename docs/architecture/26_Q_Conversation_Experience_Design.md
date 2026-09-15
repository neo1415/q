---
title: 26 — Q Conversation Experience Design
project: capital-q
date: 2026-09-15
status: working design (CQ-Q-VOICE-001 rework, second pass)
---

# 26 — Q Conversation Experience Design

What "talking to Q" is meant to feel like, how the pieces that exist today
produce that feeling, where they fall short, what each edge case does, and
what an enterprise-grade version of the same thing needs that we do not yet
have. This is the concept behind the code in `apps/q-api/src/voice/*` and
`apps/web/src/features/voice/*`; the module reference is
`docs/modules/q-voice.md`.

## 1. The concept in one paragraph

A person signs in and meets Q, not a form. Q introduces itself in its own
words, asks what to call them, and works out from whatever they say whether
they are raising or investing. From there it is one continuous conversation
in which Q gets what it needs — the company, the round, the mandate — the
way a good analyst does on a first call: it listens to whole sentences,
takes several answers from one, reads back what matters, follows a tangent
for a line and comes back, looks things up when a name or a website comes
up, reads a deck the person drops in and confirms what it found, and never
sounds like it is following a script. The person can type, tap or upload at
any point and it is the same conversation. Everything Q records goes through
the platform's own validated paths under the person's own authority; the
model talks, the code decides.

## 2. What the immersive products do, and what we take from each

| Product | What makes it feel present | What we take |
| --- | --- | --- |
| ChatGPT voice / GPT-Live | Sub-second first audio; it lets you pause without jumping in; it backchannels while you speak; tone follows content | Patient turn-taking, fillers only when genuinely slow, a manner that reacts, and pause-not-stop on interruption |
| Hume EVI | Reads the person's tone and answers in kind | Out of reach with our transport (no audio features reach Q); noted for a self-hosted pipeline |
| Sesame CSM | "Voice presence": prosody, breath, hesitations that sound human | ElevenLabs v3 conversational with expressive mode, low stability, sparing audio tags |
| Tavus CVI | 600 ms turn-taking (Sparrow), perception of the face (Raven) | The turn model and eagerness settings we can set; video is out of scope |
| LiveKit Agents | Open-source pipeline with turn detector, interruption handling, noise filtering; you own every hop | The target architecture when we outgrow the Speech Engine (see §7) |

Sources are listed at the end.

## 3. The architecture today

```
browser ── WebRTC ──► ElevenLabs Speech Engine ── WebSocket ──► q-api /v1/q/voice/ws
   │  (mic, speaker)      (ASR: Scribe realtime,                   │
   │                       TTS: v3 conversational,                  ▼
   │                       turn model v3, VAD)              turn handler (turn.ts)
   │                                                  ┌──────────┼──────────────┐
   │ polls /v1/q/voice/sessions/:id/turn      welcome host   interviewer     askQ (Q run)
   │ (asking, navigate, handoff)              (first minute) (INTERVIEW_     research tools,
   ▼                                                          CONDUCTOR)     RAG, evidence
 voice stage / welcome screen                                    │
                                                        onboarding API (validated writes)
```

- **Q is the brain.** ElevenLabs is transport: it hears and speaks. Every
  word Q says is composed on our server from our prompts, and every fact
  recorded goes through the onboarding API under the person's token.
- **One conversation, three doors.** Speaking, tapping an option and typing
  all arrive as the same turn. Uploading a document arrives as proposals Q
  reads back.
- **Two model-driven conductors, one code-enforced contract.** The welcome
  host (first minute) and the interviewer (setup) propose; code validates
  answers against the step, counts warnings, maps destinations, holds
  material values for confirmation, and routes lookups to Q's own research
  tools.

## 4. Edge cases and what happens

| Situation | What Q does | Where |
| --- | --- | --- |
| Person says something unrelated | One-line reaction in Q's manner, then back to the current question in the same turn | conductor prompt, intent OFF_TOPIC |
| A joke, an aside | Reacts like a person, carries on | SMALL_TALK |
| Deliberate derailing (abuse, "ignore your rules", nonsense) | Friendly warning, twice; third time hands to the form and ends | code-counted warnings, `handoff: FORM` |
| Interrupted mid-sentence | Pauses; "go on" / "you were saying" resumes from the sentence it was on | `held` REMAINDER in turn.ts |
| Interrupted while researching | The research keeps running; "go on" speaks it; otherwise it is offered after the next subject | `held` ANSWER, collector |
| Background noise, a cough, a dog | Turn model v3 and VAD decide; "mm-hm"/"okay" while Q speaks never interrupts; audio VAD missed is re-read at the timeout | engine turn config |
| Names Q mishears | Keyword list for the interview vocabulary and West African names/places; the person can say "it's pronounced…" and Q learns it for future sessions | ASR keywords, PRONOUNCE → pronunciation dictionary |
| Two answers in one sentence | Both recorded | conductor `answers[]` |
| "Nigeria and Ghana" for a single-choice HQ | Asks which is the main one | conductor rule |
| An option that is not on the list | Takes the words for text steps; asks for the nearest option for choices | conductor rule |
| Money, revenue, customers, exclusions | Read back and confirmed in the same turn before anything is recorded | material hold |
| "My website is vaultlyne.com" | Spelling read back; on confirmation, Q's research tool searches and reads the site; answer spoken as unverified; later offered as suggestions | LOOKUP → askQ → RESEARCH_PUBLIC_WEB |
| A deck dropped in mid-conversation | Uploaded through the evidence path, read by the worker, proposals read back and confirmed | stage Upload → DOCUMENT PROPOSALS |
| "Take me to my profile" | Navigates; only the fixed list | NAVIGATE |
| Model rate-limited | Next model on the list within the same turn (three Groq quotas, then Gemini) | gateway + `normal_dialogue.v1` |
| Model unavailable everywhere | Q says so plainly and re-asks the current step | conductor fallback |
| Person leaves and comes back | Welcome back with a one-sentence account of what's covered | opening rule |
| New person, no name | Q asks what to call them and records it | welcome host → `PATCH /v1/me` |
| Person prefers not to talk | Tap to type; "Use the form"; or drop a document instead | stage controls |

## 5. Legitimacy (what an investor can trust)

Capital Q is not a KYC provider and must not pretend to be. What it can do
honestly, with what exists:

1. **Public footprint.** When a founder names a website or company, Q's
   research tool searches the public web and reads the top sources. Sources
   are recorded as the company's own evidence with `truthClass: UNKNOWN`
   (CQ-Q-RESEARCH-001 §13). The comparison notes say deterministically
   whether a source is the declared website, names the company, or
   mentions the recorded countries.
2. **Absence is a fact too.** If there is no website and the name is not
   found, the run's answer says so, and that answer is in the conversation.
   Next step (not built): a `public_footprint` knowledge claim
   (`FOUND_WEBSITE | NAME_ONLY | NOTHING_FOUND`, with the sources) written
   by the research run so an investor's Q can answer "how real is this
   company?" from the record rather than from memory.
3. **Documents as evidence.** A deck or profile is evidence with
   provenance; claims extracted from it are proposals until confirmed.
4. **What we will not do.** Scrape LinkedIn (blocked and against terms;
   paid data providers exist, see §8), infer legitimacy from a model's
   impression, or let a research result overwrite anything the person said.

## 5a. Public profiles (Bright Data)

A LinkedIn link the person gives is looked up through Bright Data's
LinkedIn datasets (`public_profile.lookup`): one person or company page,
bounded public fields (name, headline or about, location, current role or
industries, size, headquarters, website, follower counts), returned as
unverified material Q reads back as "their LinkedIn page says". Only the
URL leaves Capital Q. With a SERP API zone and a Web Unlocker zone named,
search and page reading go through Bright Data as well (a Google index
and a page fetcher that gets past blocks); without them Tavily remains
the search provider. Zones are created in the Bright Data control panel;
their names are configuration, not secrets.

## 6. Parallelism

Today a Q run is a graph with sequential nodes. The interviewer turn and a
research run are already independent processes (the research keeps running
while the interview continues — that is what the paused-answer mechanism
uses). True fan-out inside a run — research, retrieval over the person's
documents and reasoning at once — is a change to the orchestrator graph
(`packages/q-orchestrator`): parallel tool nodes with a join, bounded by
the run budget. Worth doing when the research and RAG paths are both stable;
the per-turn model quota is the real limit today, not the graph.

## 6a. The Deepgram transport (built)

The ElevenLabs credit ceiling made the transport question urgent. The
Deepgram Voice Agent turned out to be the shortest free path: the browser
connects to Deepgram with a short-lived token, and Deepgram calls *this
server* for every turn through an OpenAI-shaped think endpoint, so Q's
conductors, tools and records are untouched. What it gives: Flux
turn-taking, barge-in, keyterms, two Aura-2 voices, and billing from the
$200 starting credit. What it does not give: backchannels while the person
speaks, tone, and noise cancellation beyond the browser's own. LiveKit
(credentials recorded, nothing built) remains the path to those.

## 7. From transport to pipeline: the enterprise path

The Speech Engine gives us a working, secure product quickly, and it has a
ceiling: it delivers only finished transcripts, so Q cannot say "mm-hm"
while the person is still talking, cannot hear tone, and noise handling is
whatever the provider offers. The next architecture, when it is time:

- **LiveKit Agents (open source), self-hosted or LiveKit Cloud.** Our own
  pipeline: STT (Scribe realtime or Deepgram Nova-3), our LLM turn, TTS
  (ElevenLabs), with LiveKit's turn detector and interruption handling.
  Gains: backchannels while the person speaks, our own VAD thresholds,
  audio-level features for tone, noise cancellation (Krisp in LiveKit Cloud,
  paid), and a full per-hop trace.
- **Observability and evals.** The turn latency budget (end of speech →
  first audio, p95 under one second), the interview transcripts joined to
  eval scores per turn, a hundred scripted scenarios in CI. We have the
  usage ledger and the smoke CLI; the transcript-to-eval join is the gap.
- **Quotas.** Paid tiers on the two providers we already use (Groq dev
  tier or Gemini paid) remove the per-minute ceiling that shaped half of
  this design.

## 8. What we need that we do not have

| Need | Options (free / freemium first) | Why |
| --- | --- | --- |
| Model quota that survives a demo | Groq developer tier; Gemini paid tier; Cerebras free tier as a third provider | 8k tokens a minute per model is the wall |
| LinkedIn / people data | Bright Data (integrated: profile lookups live; SERP + Unlocker once zones are named) | The key is configured; name the two zones to route search through it |
| Voice transport credits | ElevenLabs Starter ($6/mo, 75 agent minutes) or Creator ($22/mo, 275 minutes); overage $0.08/min | The free plan's 15 minutes were spent; every session drops on "quota exceeded" until credits exist |
| Free voice pipeline | LiveKit Cloud Build plan ($0: 1,000 agent minutes/month, Krisp noise cancellation, one hosted agent) + Deepgram ($200 free credit: Nova-3 STT, Aura-2 TTS) | The path that removes ElevenLabs minutes as a gate and adds backchannels and noise cancellation; needs LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEEPGRAM_API_KEY |
| Noise cancellation | LiveKit Cloud (Krisp) or a self-hosted RNNoise/DeepFilterNet stage | Only with the pipeline architecture |
| Backchannels, tone | LiveKit Agents pipeline | Same |
| Voice evals | Hamming, Coval, or our own scenario runner over `interview:smoke` | Regression safety once the conversation is good |
| Accent measurement | A recorded set of Nigerian, Ghanaian and Kenyan speakers through the same recogniser | No published benchmark predicts our audio |

## 9. Sources

- ElevenLabs: expressive mode; conversation flow; Speech Engine upstream
  protocol; guardrails (docs and blog, September 2026).
- Groq: rate limits and structured outputs (console docs).
- LiveKit: turn detection and interruptions; noise cancellation (blog).
- OpenAI: Advanced Voice Mode changes (2025–2026 coverage).
- Tavus: turn-taking (Sparrow), CVI overview.
- FutureAGI, Hamming: voice agent observability and testing guides (2026).
- Bright Data, Coresignal, Lix: LinkedIn data providers (2026 comparisons).
