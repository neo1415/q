/*
 * Capital Q GateQ embed. Paste on any page:
 *   <script src="https://<capital-q>/gateq-embed.js" data-gateway="gq_..." async></script>
 * It inserts the gateway in an iframe where the script tag sits. Nothing
 * here reads the host page; the gateway runs on Capital Q's own origin.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var id = script.getAttribute("data-gateway") || "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return;
  var origin = new URL(script.src).origin;
  var frame = document.createElement("iframe");
  frame.src = origin + "/g/" + encodeURIComponent(id) + "/embed";
  frame.title = "Apply with Capital Q";
  frame.loading = "lazy";
  frame.allow = "clipboard-write";
  frame.style.width = "100%";
  frame.style.maxWidth = "640px";
  frame.style.height = script.getAttribute("data-height") || "680px";
  frame.style.border = "0";
  frame.style.borderRadius = "16px";
  script.parentNode.insertBefore(frame, script.nextSibling);
})();
