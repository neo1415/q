/**
 * The page Recall's note-taker shows as its camera in CAMERA mode (owner
 * decision 2026-10-21). It runs only in Recall's browser: it shows Q's card
 * until the face's private room is ready, then the face; it sends the
 * call's audio (Recall's microphone) to that room so the face hears the
 * call; and it plays Q's own voice when the face is not there.
 *
 * Daily's client is loaded pinned, with its integrity hash; nothing else
 * is fetched but this page's own room and voice routes and Daily's rooms.
 */

/** Pinned 2026-08-19 release; the hash is of that exact file. */
const DAILY_SCRIPT = {
  src: "https://unpkg.com/@daily-co/daily-js@0.92.2/dist/daily.js",
  integrity:
    "sha384-qkOcWks7O6ZM0W8bDQRvE2Zigs/pWm7ioqYeangGqWoaqMEFUNeAKYLp8J+qWiUS",
} as const;

export function meetingFacePageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    // Daily's call engine loads from its own CDN (avoidEval: no eval).
    `script-src 'nonce-${nonce}' https://unpkg.com https://c.daily.co`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self' https://*.daily.co wss://*.daily.co",
    "media-src 'self' blob: data: mediastream:",
    "worker-src blob:",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function meetingFacePageHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Capital Q</title>
<style nonce="${nonce}">
  :root { --cq-page: #0f1115; --cq-ink: #f4f1ea; --cq-muted: #a7a39a; }
  html, body { margin: 0; height: 100%; background: var(--cq-page); color: var(--cq-ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  #card { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; }
  #mark { font-size: 120px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; }
  #name { font-size: 28px; color: var(--cq-muted); }
  #face { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
  body.live #face { display: block; }
  body.live #card { display: none; }
</style>
</head>
<body>
<div id="card"><div id="mark">Q</div><div id="name">Capital Q</div></div>
<video id="face" autoplay playsinline muted></video>
<audio id="faceVoice" autoplay></audio>
<script nonce="${nonce}" src="${DAILY_SCRIPT.src}" integrity="${DAILY_SCRIPT.integrity}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
(() => {
  const key = new URLSearchParams(location.search).get("k") || "";
  const api = (path) => location.pathname + "/" + path + "?k=" + encodeURIComponent(key);
  const face = document.getElementById("face");
  const faceVoice = document.getElementById("faceVoice");
  let mic = null;
  let call = null;
  let joining = false;

  const show = (live) => document.body.classList.toggle("live", live);

  async function microphone() {
    if (mic !== null) return mic;
    try {
      // Recall grants this without a click: it is the call's own audio.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic = stream.getAudioTracks()[0] || null;
    } catch (error) { mic = null; }
    return mic;
  }

  function onTrack(event) {
    if (!event.participant || event.participant.local) return;
    const stream = new MediaStream([event.track]);
    if (event.track.kind === "video") { face.srcObject = stream; show(true); }
    if (event.track.kind === "audio") {
      faceVoice.srcObject = stream;
      faceVoice.play().catch(() => undefined);
    }
  }

  async function leave() {
    const current = call;
    call = null;
    show(false);
    if (current === null) return;
    try { await current.leave(); } catch (error) { /* already gone */ }
    try { current.destroy(); } catch (error) { /* already gone */ }
  }

  async function tick() {
    let room = null;
    try {
      const response = await fetch(api("room"), { cache: "no-store" });
      if (response.ok) room = (await response.json()).room;
    } catch (error) { room = null; }
    if (room && call === null && !joining) {
      joining = true;
      try {
        const audio = await microphone();
        call = window.Daily.createCallObject({
          audioSource: audio === null ? false : audio,
          videoSource: false,
          dailyConfig: { avoidEval: true },
        });
        call.on("track-started", onTrack);
        call.on("participant-left", (event) => {
          if (event && event.participant && !event.participant.local) show(false);
        });
        call.on("left-meeting", () => { call = null; show(false); });
        call.on("error", () => { void leave(); });
        await call.join({ url: room.url, token: room.token });
      } catch (error) {
        await leave();
      } finally {
        joining = false;
      }
    } else if (!room && call !== null) {
      await leave();
    }
  }
  setInterval(() => { void tick(); }, 2000);
  void tick();

  // Q's own voice, when the face is not in the call.
  const lines = [];
  let playing = null;
  function next() {
    if (playing !== null || lines.length === 0) return;
    playing = new Audio("data:audio/mpeg;base64," + lines.shift());
    const done = () => { playing = null; next(); };
    playing.onended = done;
    playing.onerror = done;
    playing.play().catch(done);
  }
  const voice = new EventSource(api("voice"));
  voice.onmessage = (message) => {
    let event = null;
    try { event = JSON.parse(message.data); } catch (error) { return; }
    if (event.kind === "STOP") {
      lines.length = 0;
      if (playing !== null) { playing.pause(); playing = null; }
      return;
    }
    if (event.kind === "AUDIO" && typeof event.mp3Base64 === "string") {
      lines.push(event.mp3Base64);
      next();
    }
  };
})();
</script>
</body>
</html>`;
}
