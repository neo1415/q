import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * GateQ embed test sites (B7). Two tiny local servers, each on its own
 * origin, so the embed is exercised exactly as on an investor's website:
 *
 *   host site    the fictional "Kilima Angel Network" page (site/index.html)
 *                that pastes Capital Q's embed and launcher snippets
 *   stub origin  stands in for Capital Q when no real one is given: it serves
 *                the REAL public/gateq-embed.js and public/gateq.js, and an
 *                embed page carrying the frame-ancestors header Capital Q's
 *                proxy writes (embed-frame-policy.ts) for a listed site
 *
 * Run by hand against any Capital Q (a local stack or production):
 *
 *   node tests/gateq-embed-site/sites.ts \
 *     --capital-q https://<capital-q-web-origin> --gateway gq_<publicId> --port 4417
 *
 * then open http://localhost:4417/ . Nothing here reads or stores anything;
 * the host page is static and the stub answers three paths.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export type RunningSite = {
  readonly origin: string;
  readonly close: () => Promise<void>;
};

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

function closer(server: Server) {
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}

/** The fictional investor's page, with the snippet pointed at `capitalQOrigin`. */
export function hostPage(capitalQOrigin: string, gateway: string): string {
  return readFileSync(join(here, "site", "index.html"), "utf8")
    .replaceAll("__CAPITAL_Q_ORIGIN__", capitalQOrigin)
    .replaceAll("__GATEWAY__", gateway);
}

export async function startHostSite(options: {
  readonly port: number;
  /** "localhost" or "127.0.0.1": two different origins for the same server. */
  readonly host?: string | undefined;
  readonly capitalQOrigin: string;
  readonly gateway: string;
}): Promise<RunningSite> {
  const page = hostPage(options.capitalQOrigin, options.gateway);
  const server = createServer((request, response) => {
    if (
      request.method !== "GET" ||
      (request.url ?? "/").split("?")[0] !== "/"
    ) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(page);
  });
  // Listen on loopback; both "localhost" and "127.0.0.1" reach it, and the
  // browser treats them as different origins.
  await listen(server, options.port, "127.0.0.1");
  return {
    origin: `http://${options.host ?? "localhost"}:${String(options.port)}`,
    close: closer(server),
  };
}

/** The header Capital Q's proxy writes for a gateway with these sites listed. */
export function frameAncestors(allowed: readonly string[]): string {
  return allowed.length === 0
    ? "frame-ancestors *"
    : `frame-ancestors 'self' ${allowed.join(" ")}`;
}

export async function startStubCapitalQ(options: {
  readonly port: number;
  readonly allowedOrigins: readonly string[];
}): Promise<RunningSite> {
  const scripts: Readonly<Record<string, string>> = {
    "/gateq-embed.js": readFileSync(
      join(repoRoot, "apps/web/public/gateq-embed.js"),
      "utf8",
    ),
    "/gateq.js": readFileSync(
      join(repoRoot, "apps/web/public/gateq.js"),
      "utf8",
    ),
  };
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const script = scripts[path];
    if (script !== undefined) {
      response
        .writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
        .end(script);
      return;
    }
    if (/^\/g\/[A-Za-z0-9_-]{4,64}\/embed\/?$/u.test(path)) {
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": frameAncestors(options.allowedOrigins),
        })
        .end(
          '<!doctype html><html lang="en"><body><main><h1>Apply to Kilima Angel Network (fictional)</h1>' +
            '<label>Full name <input name="name"></label></main></body></html>',
        );
      return;
    }
    response.writeHead(404).end();
  });
  await listen(server, options.port, "127.0.0.1");
  return {
    origin: `http://127.0.0.1:${String(options.port)}`,
    close: closer(server),
  };
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const capitalQ = argument("capital-q");
  const gateway = argument("gateway");
  const port = Number(argument("port") ?? "4417");
  if (capitalQ === undefined || gateway === undefined) {
    console.error(
      "usage: node tests/gateq-embed-site/sites.ts --capital-q <origin> --gateway <publicId> [--port 4417]",
    );
    process.exit(2);
  }
  const site = await startHostSite({ port, capitalQOrigin: capitalQ, gateway });
  console.log(`Kilima Angel Network (fictional) test site: ${site.origin}/`);
}
