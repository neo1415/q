# Question for Tavus support (draft, 2026-10-18)

Subject: Live conversation events for PALs joined to Google Meet via `meeting_url`

Hi Tavus team,

We create conversations with `meeting_url` set to a Google Meet link, so our PAL (with a conferencing layer) joins the Meet directly. Our LLM layer is a custom `base_url`.

For these Meet-mode conversations, can our server receive the live conversation events while the call is running, specifically `conversation.utterance` (with `participant_id` and `participant_name`), `conversation.joined` / `conversation.left`, and `conversation.started_speaking` / `stopped_speaking`?

1. Can these be delivered to `callback_url` (or another server-side webhook) for `meeting_url` conversations? If yes, what is the payload and how are the requests signed or authenticated?
2. If not, is there any server-side way to get per-speaker, near-real-time transcripts of a Meet call the PAL is in?
3. Can we set the name the PAL shows under in Google Meet? Ours appeared as "PAL AI". Is it taken from `pal_name`, `conversation_name` or something else?

Thank you.
