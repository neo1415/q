// Used on 13 Nov 2026 to apply demo-activate.mjs plans (set-stage, assess) for fictional
// seed founders without the service-role key: JOBS from the dry run, seed password only.
// Demo activation, founder-session path: sign in as the fictional founder in the web app (seed password),
// take that founder's own API session from the app's own requests, then set the stage (if still absent) and assess.
// Prints no token. Fictional accounts only.
const { chromium } = require("playwright");
const crypto = require("node:crypto");
const WEB = "https://capital-qweb-production.up.railway.app";
const API = "https://capital-qapi-production.up.railway.app";
const jobs = JSON.parse(process.env.JOBS); // [{email, companyId, stage, source}]
const idem = (...p) => {
  const h = crypto.createHash("sha256").update(p.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
(async () => {
  const b = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--no-sandbox"],
  });
  for (const job of jobs) {
    if (!job.email.endsWith("@fictional.capitalq.local")) {
      console.log(job.companyId, "REFUSED: not a fictional account");
      continue;
    }
    const ctx = await b.newContext();
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem("cq.splash.seen", "1");
      } catch {}
    });
    const p = await ctx.newPage();
    let bearer = null;
    p.on("request", (r) => {
      if (!bearer && r.url().startsWith(API)) {
        const a = r.headers()["authorization"];
        if (a && a.startsWith("Bearer ")) bearer = a;
      }
    });
    try {
      await p.goto(`${WEB}/auth/sign-in`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await p.waitForSelector("input[type=email]");
      await p.fill("input[type=email]", job.email);
      await p.fill(
        "input[type=password]",
        process.env.CQ_SEED_ACCOUNT_PASSWORD,
      );
      await Promise.all([
        p.waitForURL((u) => !u.pathname.includes("sign-in"), {
          timeout: 45000,
          waitUntil: "commit",
        }),
        p.keyboard.press("Enter"),
      ]);
      // The app's server calls the API, so take the founder's own session from its auth cookie
      // (Supabase SSR: "sb-<ref>-auth-token", possibly split into .0/.1 chunks, "base64-" prefixed JSON).
      await p.waitForTimeout(1500);
      const cookies = (await ctx.cookies())
        .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      let raw = cookies.map((c) => c.value).join("");
      if (raw.startsWith("base64-"))
        raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
      try {
        const s = JSON.parse(decodeURIComponent(raw));
        if (typeof s.access_token === "string")
          bearer = `Bearer ${s.access_token}`;
      } catch {}
      if (!bearer)
        throw new Error(`no session cookie (${cookies.length} auth cookies)`);
      const call = async (method, path, body, key) => {
        const r = await p.request.fetch(`${API}${path}`, {
          method,
          headers: {
            authorization: bearer,
            "content-type": "application/json",
            ...(key ? { "idempotency-key": key } : {}),
          },
          data: body === undefined ? undefined : JSON.stringify(body),
        });
        let j = null;
        try {
          j = await r.json();
        } catch {}
        return { status: r.status(), body: j };
      };
      const base = `/v1/companies/${job.companyId}`;
      const cur = await call("GET", base);
      if (cur.status !== 200) throw new Error(`GET company ${cur.status}`);
      let stageOut = `already ${cur.body.currentStageCode}`;
      if (!cur.body.currentStageCode) {
        const u = await call(
          "PATCH",
          base,
          { expectedVersion: cur.body.version, currentStageCode: job.stage },
          idem(job.companyId, "set-stage", job.stage),
        );
        stageOut =
          u.status >= 200 && u.status < 300
            ? `set ${job.stage} (${job.source})`
            : `PATCH ${u.status} ${JSON.stringify(u.body).slice(0, 160)}`;
      }
      const a = await call("POST", `${base}/marketplace-readiness/assess`, {});
      const outstanding = (a.body?.requirements ?? [])
        .filter((q) => q.outcome === "OUTSTANDING")
        .map((q) => q.requirement);
      console.log(
        job.companyId,
        job.email.split("@")[0],
        "| stage:",
        stageOut,
        "| readiness:",
        a.status,
        a.body?.state ?? "?",
        outstanding.length ? `outstanding ${outstanding.join(",")}` : "",
      );
    } catch (e) {
      console.log(job.companyId, "ERROR", String(e.message).slice(0, 160));
    }
    await ctx.close();
    await new Promise((r) => setTimeout(r, 1500));
  }
  await b.close();
})();
