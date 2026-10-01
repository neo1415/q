import type { NextConfig } from "next";

/**
 * Baseline response headers. Conservative and additive: nothing here loosens
 * framing, content-type or referrer protection. A full Content-Security-Policy
 * needs nonce plumbing through the request path and arrives with the
 * identity/auth application slice rather than as an afterthought here.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone: Q's voice. Camera: the rehearsal room's self-view, which
  // stays in the browser (REHEARSE; live 2026-10-01 the camera button was
  // refused by this header). Display capture is not listed, so it keeps
  // its default of self (the rehearsal's screen share). Location is not a
  // product feature.
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=(self)",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `/@handle` is the Q Card's public address (BIZ-004). An `@` segment is
  // a parallel-route slot in the App Router, so the page lives at
  // `/u/[handle]` and the public address is a rewrite onto it. The vCard
  // rule comes first so `.vcf` is never read as part of a handle.
  rewrites() {
    return Promise.resolve([
      { source: "/@:handle([a-z0-9-]+).vcf", destination: "/u/:handle/vcard" },
      // The card to save or send (founder design 2026-09-28).
      {
        source: "/@:handle([a-z0-9-]+).png",
        destination: "/u/:handle/card.png",
      },
      {
        source: "/@:handle([a-z0-9-]+).pdf",
        destination: "/u/:handle/card.pdf",
      },
      { source: "/@:handle([A-Za-z0-9-]+)", destination: "/u/:handle" },
    ]);
  },
  // Q's page lives at /home, where every `/home?c=` link already points.
  // /q is its short address; the query string (a conversation id) is
  // carried across. Temporary, so the canonical route can still move.
  redirects() {
    return Promise.resolve([
      { source: "/q", destination: "/home", permanent: false },
    ]);
  },
  headers() {
    return Promise.resolve([
      { source: "/(.*)", headers: securityHeaders },
      // Nothing is framed by another site except the GateQ embed below.
      {
        source: "/((?!g/[^/]+/embed$).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        // GateQ embed (spec §1): the one page another site may frame.
        source: "/g/:publicId/embed",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Authentication responses are never shared-cacheable: a callback that
        // sets session cookies, or a sign-in page rendered with a notice,
        // must not be served to anyone else by a CDN or proxy.
        source: "/auth/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // The service worker must never be cached indefinitely, or an old
        // caching policy could outlive the code that replaced it.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, max-age=0, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
