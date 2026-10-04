# Full-duplex voice: one supervised 5-minute live test (duplex-56)

One person, one laptop with a headset (echo cancellation works better with one), the founder account, on the hosted demo. Expected cost: **about $0.50** in OpenAI Realtime usage (gpt-realtime-mini), and a few cents of ordinary Q answers. The test caps itself at $0.75 for the day (see below), so a mistake cannot cost more than that.

## What it is

With the flag on, a voice session opens a **full-duplex line**: Q listens while it talks, you can cut in mid-sentence and Q stops at once, and short "mm-hmm"s happen without walkie-talkie lag.

- **The line.** The Q API checks who you are, then today's spend, then plans the line with the Context Firewall exactly as a typed answer is planned. Only then does it mint a 60-second client secret through the Model Gateway. The browser connects to OpenAI over WebRTC with that secret only. The API key never leaves the Q API.
- **Answers.** Everything substantive goes back to the Q API (`ask_q`) and runs as the same spoken turn the standard voice takes: the same tools with authorize, and approvals as cards on screen.
- **Fallback.** Anything that goes wrong (the flag is off, the cap is reached, the network fails, or the line hits its 10-minute maximum) falls back to today's voice on the same conversation. When the fallback is caused by the cap, you see one sentence about it.

## Turn it on (Railway)

Both services need the flag. If either one is off, every session is the standard voice.

1. Railway → project Q → service **`@capital-q/q-api`** → Variables. Set:
   - `CQ_VOICE_REALTIME` = `on`
   - `CQ_VOICE_REALTIME_DAILY_CAP_USD` = `0.75` (for the test day; the default is `1.00`)
   - Leave the others at their defaults:
     - `CQ_VOICE_REALTIME_MAX_SESSION_SECONDS` (default 600);
     - `CQ_VOICE_REALTIME_IDLE_SECONDS` (default 30);
     - `CQ_VOICE_REALTIME_SESSION_RESERVE_USD` (default 0.25);
     - `CQ_VOICE_REALTIME_MAX_OUTPUT_TOKENS` (default 800);
     - `CQ_VOICE_REALTIME_DIRECT_TOOLS` (default 6).
   - `OPENAI_API_KEY` must already be set (it is for the text gateway).
2. Railway → service **`@capital-q/web`** → Variables. Set:
   - `CQ_VOICE_REALTIME` = `on`
3. Both services redeploy on save. Wait for both deploys to go green.
4. Apply the migration `20261203090000_model_usage_voice_realtime` (`pnpm db:push`) **before** the test. It is additive. Without it, usage rows fail to write, and every line falls back after its first answer (fail closed).
5. In the q-api deploy log, look for `duplex voice composed` with `enabled: true`.

Realtime only opens on a deployment whose context can go to OpenAI. OpenAI is recorded as UNREVIEWED (ceiling PUBLIC), so on anything but the attested synthetic demo, every line falls back. That is by design.

## Turn it off (Railway)

- Set `CQ_VOICE_REALTIME` to `off` (or delete it) on **`@capital-q/q-api`**. That alone stops every new line; lines already open hand over within their next answer or after 10 minutes.
- Also set it off on **`@capital-q/web`**, so the browser stops asking.
- Emergency, with no redeploy: set `CQ_VOICE_REALTIME_DAILY_CAP_USD` = `0` on q-api. Every new line falls back, and open lines stop at their next answer.

## The test (supervised, 5 minutes)

| Min  | Do                                                                                           | Look for                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Sign in as the founder. Open Q and start voice.                                              | Q greets you within a second or two. The q-api log shows `voice session issued` with `duplex: true` and `duplex voice line minted`.      |
| 0:30 | Ask "How is my raise going?"                                                                 | A short "one moment", then Q's answer, the same facts the typed answer gives. The log shows a `q tool call finished` line for the Q run. |
| 1:15 | Ask something long ("Walk me through my investor pipeline"). Mid-sentence, say "wait, stop". | Q's audio stops **at once**, with no tail. Q reacts to "wait, stop" and does not start over.                                             |
| 2:00 | Talk for 15 seconds about your week, with pauses.                                            | Short back-channels ("mm-hmm", "right") while you talk, and no barge-in from Q.                                                          |
| 2:45 | Say "Change my round size to two million."                                                   | Q says what it prepared and that it is **on your screen to approve**. A card appears. Say "yes".                                         |
| 3:15 | —                                                                                            | The change is saved, the same as a tap on the card. Nothing changes without the yes.                                                     |
| 3:30 | Stay silent for 35 seconds.                                                                  | The line ends by itself (idle). No fallback starts, and voice is off.                                                                    |
| 4:15 | Start voice again. Turn Wi-Fi off for 5 seconds, then on.                                    | The voice carries on, on the standard line, in the same conversation, with no greeting. This is the silent fallback.                     |
| 5:00 | End voice.                                                                                   | —                                                                                                                                        |

## After the test

- Spend: in Settings → Usage, "Live voice" shows about $0.50. Or query it directly:
  ```sql
  select round(sum(cost_usd), 4)
    from ai_ops.model_usage
   where purpose = 'VOICE_REALTIME'
     and occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  ```
- If you are not keeping it on, turn the flag off on both services (see above).
- Report the following:
  - the spend;
  - whether barge-in felt instant;
  - any line Q said that was not in the typed answer (it should only relay);
  - any moment the fallback was noticeable.
