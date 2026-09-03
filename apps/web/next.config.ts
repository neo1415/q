import type { NextConfig } from "next";

/**
 * Baseline response headers. Conservative and additive: nothing here loosens
 * framing, content-type or referrer protection. A full Content-Security-Policy
 * needs nonce plumbing through the request path and arrives with the
 * identity/auth application slice rather than as an afterthought here.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone stays reservable for Capital Q's own voice capability later;
  // camera and location are not product features.
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self)",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      { source: "/(.*)", headers: securityHeaders },
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
