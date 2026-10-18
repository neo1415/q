/*
 * Capital Q - GateQ "Check your fit" launcher (F1: opens the GateQ form). Paste once, anywhere on a page:
 *
 *   <script src="https://<capital-q>/gateq.js" data-gate="gq_..." async></script>
 *
 * Optional: data-label="Check your fit"  data-position="left|right"
 *           data-theme="light|dark" (defaults to the visitor's preference)
 *
 * What it does: draws one small button in a closed shadow root (so the host
 * page's CSS cannot restyle it, and it cannot restyle the host page), and on
 * the first press opens Capital Q's own page in an iframe. The conversation
 * runs entirely on Capital Q's origin: this script reads nothing from the
 * host page, sets no cookies, stores nothing, and loads nothing until the
 * visitor asks. Hex colours live here only because a host page has none of
 * Capital Q's design tokens.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !("attachShadow" in Element.prototype)) return;
  var id =
    script.getAttribute("data-gate") ||
    script.getAttribute("data-gateway") ||
    "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return;
  if (window.__capitalQGateQ) return; // one launcher per page
  window.__capitalQGateQ = true;

  var origin = new URL(script.src).origin;
  var label = (script.getAttribute("data-label") || "Check your fit").slice(
    0,
    40,
  );
  var left = script.getAttribute("data-position") === "left";
  var theme = script.getAttribute("data-theme");
  var dark =
    theme === "dark" ||
    (theme !== "light" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  var ink = dark ? "#f4f5f7" : "#111318";
  var paper = dark ? "#111318" : "#ffffff";
  var edge = dark ? "rgba(255,255,255,0.14)" : "rgba(17,19,24,0.12)";
  var side = left ? "left" : "right";

  var host = document.createElement("div");
  host.setAttribute("data-capital-q", "gateq");
  var root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".launch{position:fixed;bottom:20px;" +
    side +
    ":20px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 18px 0 12px;border-radius:999px;border:1px solid " +
    edge +
    ";background:" +
    ink +
    ";color:" +
    paper +
    ";font-size:15px;font-weight:600;letter-spacing:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18)}" +
    ".launch:focus-visible,.close:focus-visible{outline:3px solid " +
    (dark ? "#c9a227" : "#8a6a12") +
    ";outline-offset:2px}" +
    ".mark{width:24px;height:24px;flex:none}" +
    ".panel{position:fixed;bottom:84px;" +
    side +
    ":20px;z-index:2147483001;width:400px;height:min(680px,calc(100vh - 112px));border-radius:16px;overflow:hidden;border:1px solid " +
    edge +
    ";background:" +
    paper +
    ";box-shadow:0 24px 64px rgba(0,0,0,.28);opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}" +
    ".panel[data-open]{opacity:1;transform:none}" +
    ".panel[hidden]{display:none}" +
    "iframe{display:block;width:100%;height:100%;border:0;background:" +
    paper +
    "}" +
    ".close{position:absolute;top:6px;right:6px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:" +
    ink +
    ";cursor:pointer}" +
    "@media (max-width:520px){.panel{inset:0;width:100%;height:100%;border-radius:0;bottom:0;" +
    side +
    ":0}}" +
    "@media (prefers-reduced-motion:reduce){.panel{transition:none}}" +
    "</style>" +
    '<button class="launch" type="button" aria-haspopup="dialog" aria-expanded="false">' +
    '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>' +
    '<span class="text"></span></button>' +
    '<div class="panel" role="dialog" aria-modal="false" aria-label="Check your fit" hidden>' +
    '<button class="close" type="button" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>';

  var launch = root.querySelector(".launch");
  var panel = root.querySelector(".panel");
  var close = root.querySelector(".close");
  root.querySelector(".text").textContent = label;
  var frame = null;

  function open() {
    // Shown first, framed second: the conversation lays out in a visible
    // panel, so Q's presence measures and draws at its real size.
    panel.hidden = false;
    if (!frame) {
      // Created on first press: an embed costs the host page nothing until used.
      frame = document.createElement("iframe");
      frame.src = origin + "/g/" + encodeURIComponent(id) + "/embed";
      frame.title = "Fit check with Q";
      frame.allow = "clipboard-write";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      // Its own origin, scripts and forms; never the host's top window.
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
      );
      panel.insertBefore(frame, close);
    }
    requestAnimationFrame(function () {
      panel.setAttribute("data-open", "");
    });
    launch.setAttribute("aria-expanded", "true");
    frame.focus();
  }

  function shut() {
    panel.removeAttribute("data-open");
    panel.hidden = true;
    launch.setAttribute("aria-expanded", "false");
    launch.focus();
  }

  launch.addEventListener("click", function () {
    if (panel.hidden) open();
    else shut();
  });
  close.addEventListener("click", shut);
  root.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) shut();
  });

  function mount() {
    document.body.appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
