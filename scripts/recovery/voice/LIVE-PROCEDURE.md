# LIVE voice procedure (for the founder, on your own machine)

Every voice test in this build ran **MOCK**: WebRTC and the Deepgram socket are faked in the browser, and the model is `scripts/recovery/fake-vendors.mjs`. The build budget for live AI calls is **$0**, so nothing LIVE was run, and every live result is reported **LIVE-PENDING** until you run this procedure.

You need your own machine, Capital Q's existing local configuration (`.env.local` with the keys you already use), a microphone, and about 30 minutes. Nothing here touches production or the hosted database.

## 1. What it costs, before you start

```bash
node scripts/recovery/live-cost.mjs estimate --text-turns 10 --voice-minutes 3 \
  --audio-in-per-m <from openai.com/api/pricing> --audio-out-per-m <same page>
```

The text figure comes from the local price catalogue and the prompt sizes measured in MOCK runs. It is a ceiling, because output is counted at its 4,096-token cap. The voice figure uses the rates you pass. The realtime line is hard-capped by `CQ_LIVE_BUDGET_USD`. Text inference has no aggregate cap today (audit F-08), so keep the number of turns small.

## 2. Start the local stack in LIVE mode

```bash
pnpm install --frozen-lockfile && pnpm turbo run build --filter="./packages/*"
export CQ_RECOVERY_MODE=live
export CQ_LIVE_OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' .env.local | cut -d= -f2-)"   # your existing key; never commit it
export CQ_LIVE_DEEPGRAM_API_KEY="$(grep '^DEEPGRAM_API_KEY=' .env.local | cut -d= -f2-)" # optional: the standard line
export CQ_LIVE_BUDGET_USD=1
scripts/recovery/local-stack.sh start && scripts/recovery/local-stack.sh seed
date -u +%FT%TZ > .playwright/recovery-stack/live-started-at
```

The services run behind the egress guard. Only `api.openai.com`, `api.deepgram.com` and `agent.deepgram.com` are reachable. Every other host is refused and logged as "recovery egress refused".

## 3. Real microphone: the live project

```bash
CQ_LIVE_REAL_MIC=1 npx playwright test -c tests/recovery/playwright.recovery.config.ts --project live
```

A browser window opens, signed in as Ledgerfold's founder. When the line shows **End**, say **"How much am I raising?"**. Then run the voice scenarios with your own voice (E, G and the H voice cases), using the scripts in `tests/recovery/scenarios/` and `tests/recovery/voice/` as the checklist:

- talk across three pages;
- interrupt Q mid-sentence and correct yourself;
- type a follow-up, then speak again;
- turn the microphone permission off mid-line;
- switch Wi-Fi off for five seconds.

## 4. Five Nigerian-English clips

Record five short clips, 3–8 seconds each, at a normal pace in a normal room. Use any recorder that can export WAV, or `ffmpeg -f avfoundation -i ":0" -ac 1 -ar 16000 -sample_fmt s16 01-raise.wav` on a Mac. Put each in `.playwright/recovery-stack/clips/`, with a `.txt` file holding the exact words:

| File               | Say                                          |
| ------------------ | -------------------------------------------- |
| `01-raise.wav`     | How much are we raising for this round?      |
| `02-navigate.wav`  | Abeg carry me go my documents.               |
| `03-attention.wav` | Wetin dey need my attention today?           |
| `04-investor.wav`  | Open Savanna Seed and show me their mandate. |
| `05-correct.wav`   | Send it on Tuesday, no, Wednesday morning.   |

Convert anything else first: `ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 01-raise.wav`.

```bash
node scripts/recovery/voice/play-clips.mjs
npx playwright test -c tests/recovery/playwright.recovery.config.ts --project live -g clip
```

Each clip writes `NN-name.heard.json`, with the expected words, the words heard and the word error rate.

## 5. Measure, record the cost, stop

```bash
node scripts/recovery/perf-report.mjs .playwright/recovery-stack/q-api.log
node scripts/recovery/live-cost.mjs actual --since "$(cat .playwright/recovery-stack/live-started-at)"
scripts/recovery/local-stack.sh stop
```

Paste the three outputs and the `.heard.json` files into `docs/recovery/evidence/<date>/live.md`, labelled **LIVE**. Then check the OpenAI usage page: the local `ai_ops.model_usage` prices realtime at one text rate, so the billed audio figure is the authority.
