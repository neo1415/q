// Work page design prototype (PROPOSED). Static, fictional data only.
// Query parameters pick the state so every screen is reproducible:
//   role=investor|founder  tab=tasks|documents|pitch|rehearsals|daily
//   state=ready|empty|loading|error  theme=light|dark  motion=reduced
//   reader=1  nav=a|b  sheet=more  view=app|compare|phones
(() => {
  const params = new URLSearchParams(location.search);
  const S = {
    role: params.get("role") === "founder" ? "founder" : "investor",
    tab: params.get("tab") || "tasks",
    state: params.get("state") || "ready",
    nav: params.get("nav") === "b" ? "b" : "a",
    view: params.get("view") || "app",
    approved: false,
  };
  const root = document.documentElement;
  if (params.get("theme") === "dark") root.dataset.theme = "dark";
  else root.dataset.theme = "light";
  if (params.get("motion") === "reduced") root.dataset.motion = "reduced";

  // ---- icons (Lucide geometry, drawn at 24) ----
  const P = {
    compass:
      '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
    explore:
      '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    work: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    rehearse:
      '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    daily:
      '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
    user: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',
    settings:
      '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    lock: '<rect width="8" height="5" x="14" y="17" rx="1"/><path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5"/><path d="M20 17v-2a2 2 0 1 0-4 0v2"/>',
    folder:
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    retry:
      '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    stop: '<rect width="12" height="12" x="6" y="6" rx="1"/>',
    alert:
      '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.56v16.16a.6.6 0 0 1-.74.58L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56Z"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  };
  const ic = (n, cls = "") =>
    `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  // Q's mark: ring and tail. A sweep moves only while work is running.
  const qMark = (cls = "", running = false) =>
    `<svg class="q-mark ${cls} ${running ? "running" : ""}" viewBox="0 0 24 24" aria-hidden="true">${
      running
        ? '<circle class="ring-base" cx="12" cy="11" r="7"/><circle class="sweep" cx="12" cy="11" r="7"/>'
        : '<circle cx="12" cy="11" r="7"/>'
    }<path d="M15.6 15.4 20 20.5"/></svg>`;

  // ---- people and content (fictional) ----
  const WHO = {
    investor: {
      org: "Atlas Health Partners",
      scope: "Investor",
      initials: "AH",
    },
    founder: { org: "Studio Ekun", scope: "Founder", initials: "SE" },
  };
  const TABS = [
    { id: "tasks", label: "Tasks", path: "/work" },
    { id: "documents", label: "Documents", path: "/documents" },
    { id: "pitch", label: "Pitch", path: "/pitch", founder: true },
    { id: "rehearsals", label: "Rehearsals", path: "/rehearsals" },
    { id: "daily", label: "The Q Daily", path: "/daily" },
  ];
  const tabsFor = () => TABS.filter((t) => !t.founder || S.role === "founder");

  // ---- sidebar ----
  const sbLink = (icon, label, opts = {}) =>
    `<a href="#" class="sb-link ${opts.nested ? "nested" : ""}" data-nav="${label}" ${
      opts.active ? 'aria-current="page"' : ""
    }>${icon === "q" ? qMark("glow") : ic(icon)}<span class="label">${label}</span>${
      opts.count ? `<span class="sb-count" data-count>${opts.count}</span>` : ""
    }</a>`;
  const needs = () => (S.state === "ready" ? (S.approved ? 1 : 2) : 0);

  function sidebar(variant = "after", activeWork = true) {
    const w = WHO[S.role];
    const main =
      sbLink("compass", "Discover") +
      sbLink("explore", "Explore") +
      sbLink("q", "Q") +
      sbLink("users", "CRM");
    let body;
    let foot;
    if (variant === "before") {
      const workspace =
        S.role === "founder"
          ? [
              ["work", "Work", 2],
              ["play", "Pitch & media"],
              ["lock", "Data room & deck"],
              ["file", "Documents"],
              ["rehearse", "Rehearsals"],
              ["daily", "The Q Daily"],
            ]
          : [
              ["work", "Work", 2],
              ["file", "Documents"],
              ["rehearse", "Rehearsals"],
              ["daily", "The Q Daily"],
            ];
      body =
        main +
        `<div class="sb-group-label">Workspace ${ic("down", "sm")}</div>` +
        workspace
          .map(([i, l, c]) =>
            sbLink(i, l, { nested: true, count: c, active: l === "Work" }),
          )
          .join("") +
        `<div class="sb-group-label">You ${ic("down", "sm")}</div>` +
        sbLink("user", "Profile", { nested: true }) +
        sbLink("settings", "Settings", { nested: true });
      foot = "";
    } else {
      body =
        main +
        sbLink("work", "Work", { active: activeWork, count: needs() || "" });
      foot =
        sbLink("user", "Profile") + sbLink("settings", "Settings");
    }
    return `<aside class="sidebar" aria-label="Primary">
      <div class="sb-head"><span class="sb-brand">Capital Q</span>
        <button class="sb-icon" aria-label="Collapse sidebar">${ic("panel")}</button></div>
      <nav class="sb-nav">${body}</nav>
      <div class="sb-foot">${foot}
        <div class="sb-context"><strong>${w.org}</strong>${w.scope} workspace</div>
        <div class="sb-tools">
          <button class="sb-icon" aria-label="Theme">${ic("sun")}</button>
          <button class="sb-icon" aria-label="Notices">${ic("bell")}</button>
          <button class="sb-icon" aria-label="Sign out">${ic("out")}</button>
        </div>
      </div>
    </aside>`;
  }

  // ---- tabs ----
  function tabStrip() {
    return `<nav class="tabs" aria-label="Work" data-tabs>
      ${tabsFor()
        .map(
          (t) =>
            `<a class="tab" href="${t.path}" data-tab="${t.id}" data-label="${t.label}" ${
              S.tab === t.id ? 'aria-current="page"' : ""
            }><span class="tab-row">${t.label}${
              t.id === "tasks" && needs() ? `<span class="count num" data-count>${needs()}</span>` : ""
            }</span></a>`,
        )
        .join("")}
      <span class="tab-ink" data-ink></span>
    </nav>`;
  }
  function placeInk(animate) {
    const strip = document.querySelector("[data-tabs]");
    if (!strip) return;
    const ink = strip.querySelector("[data-ink]");
    const open = strip.querySelector('[aria-current="page"]');
    if (!open) return;
    if (!animate) ink.style.transition = "none";
    ink.style.transform = `translateX(${open.offsetLeft}px) scaleX(${open.offsetWidth})`;
    if (!animate) {
      ink.getBoundingClientRect();
      ink.style.transition = "";
    }
    // Keep the open tab in view on a narrow strip (as the CRM does).
    const box = open.getBoundingClientRect();
    const frame = strip.getBoundingClientRect();
    if (box.right > frame.right) strip.scrollLeft += box.right - frame.right + 16;
    else if (box.left < frame.left) strip.scrollLeft -= frame.left - box.left + 16;
  }

  // ---- Tasks ----
  const composer = (value = "") => `<div class="composer">
      ${qMark("glow")}
      <label class="sr-only" for="task">Give Q a task</label>
      <input id="task" placeholder="Give Q a task…" value="${value}" />
      <button class="btn btn-icon btn-quiet" aria-label="Talk to Q">${ic("mic")}</button>
      <button class="btn btn-icon send" aria-label="Give Q this task">${ic("up")}</button>
    </div>`;

  const APPROVAL = {
    investor: {
      title: "Send Studio Ekun a follow-up",
      summary:
        "Ask Studio Ekun for the Q3 cohort retention table before Thursday's call.",
      quote:
        "Hello Studio Ekun team, ahead of Thursday could you share the Q3 cohort retention table you mentioned? The deck shows months 1–6; we'd like months 7–12 as well. Thank you.",
      alone: "Sends this one message from your Atlas Health Partners address",
      asks: "Before replying to anything they send back",
      to: "Studio Ekun",
    },
    founder: {
      title: "Share your data room with Halden Ventures",
      summary:
        "Give Halden Ventures read access to Financials and Product & tech for 14 days.",
      quote:
        "Halden Ventures asked for the model after Tuesday's call. Access ends 31 Oct; they can view, not download.",
      alone: "Grants view access to two folders, for 14 days",
      asks: "Before sharing Legal or Team",
      to: "Halden Ventures",
    },
  };

  function approvalCard() {
    const a = APPROVAL[S.role];
    if (S.approved === "done")
      return `<div class="approval-done" role="status">${ic("check", "ok")}<span><strong>Approved.</strong> Q is doing it now. It moves to Done when it's sent.</span></div>`;
    return `<article class="approval ${S.approved === "pending" ? "pending" : ""}" data-approval>
      <div class="approval-top">${qMark()}<span>Waiting for your yes</span><span class="when">12 min ago</span></div>
      <p class="t-title-sm" style="font-size:17px">${a.title}</p>
      <p class="t-body muted" style="margin-top:-8px">${a.summary}</p>
      <blockquote><span class="sr-only">What Q will send:</span>${a.quote}</blockquote>
      <dl><dt>On its own</dt><dd>${a.alone}</dd><dt>Asks first</dt><dd>${a.asks}</dd></dl>
      <div class="approval-actions">
        <button class="btn btn-primary" data-approve>${
          S.approved === "pending"
            ? '<span class="spinner" aria-hidden="true"></span> Approving…'
            : "Approve"
        }</button>
        <button class="btn btn-secondary">Review</button>
        <button class="btn btn-quiet">Not now</button>
      </div>
    </article>`;
  }

  const SECOND = {
    investor: {
      title: "Kestrel Grid's runway disagrees between two documents",
      meta: "Deck says 14 months · financial model says 11 months · both kept until you choose",
    },
    founder: {
      title: "Confirm a fact Q read from your deck",
      meta: "Annual recurring revenue £1.2m (deck, slide 9) · not yet on your profile",
    },
  };
  const RUNNING = {
    investor: [
      {
        t: "Comparing Ledgerfold with three similar seed-stage companies",
        m: "Step 3 of 5 · reading Ledgerfold's data room · 18 credits so far",
        p: 60,
      },
      {
        t: "Watching Studio Ekun's data room for new financials",
        m: "Standing instruction · checks daily · last check 09:12",
        watch: true,
      },
    ],
    founder: [
      {
        t: "Drafting answers to the six questions Halden Ventures sent",
        m: "Step 2 of 4 · checking each answer against your model · 9 credits so far",
        p: 45,
      },
      {
        t: "Keeping your data room index up to date",
        m: "Standing instruction · runs on each upload · last run 08:40",
        watch: true,
      },
    ],
  };
  const DONE = {
    investor: [
      ["Thu", "Brief: Ledgerfold, seed round", "Report"],
      ["Wed", "Comparison: Kestrel Grid and four peers", "Report"],
      ["Wed", "Intro note sent to Marrow Labs", "Outreach"],
      ["Mon", "Weekly pipeline digest", "Report"],
    ],
    founder: [
      ["Thu", "Investor update for October, sent to 12 investors", "Outreach"],
      ["Wed", "Rehearsal notes: Copperline Capital", "Report"],
      ["Tue", "Deck v4 checked against the model", "Report"],
      ["Mon", "Weekly pipeline digest", "Report"],
    ],
  };
  const SUGGEST = {
    investor: [
      "Prepare questions for Thursday's call with Ledgerfold",
      "Summarise what changed in your pipeline this week",
      "Find the evidence behind Tidewater Freight's margin claim",
    ],
    founder: [
      "Prepare for Tuesday's call with Copperline Capital",
      "Turn this week's progress into an investor update",
      "Close the three gaps investors see on your profile",
    ],
  };

  function doneRows(extra) {
    const rows = DONE[S.role]
      .map(
        ([d, t, k]) =>
          `<li class="row"><div class="lead">${ic("check", "sm faint")}</div><div class="body"><div class="title">${t}</div></div><span class="kind">${k}</span><span class="when" style="min-width:40px">${d}</span><a class="link" href="#" style="padding:0 4px">Open</a></li>`,
      )
      .join("");
    return (extra || "") + rows;
  }

  function tasksPanel() {
    if (S.state === "loading")
      return `<div class="tasks-grid" aria-busy="true"><div><div class="sk" style="height:56px"></div>
        <div class="section"><div class="sk" style="width:140px;height:18px"></div>
        <div class="sk" style="height:200px;margin-top:14px"></div></div>
        <div class="section"><div class="sk" style="width:120px;height:18px"></div>
        ${[1, 2, 3].map(() => `<div style="display:flex;gap:14px;margin-top:20px"><div class="sk" style="width:24px;height:24px"></div><div style="flex:1;display:grid;gap:8px"><div class="sk" style="width:62%"></div><div class="sk" style="width:38%;height:10px"></div></div></div>`).join("")}
        </div></div><div><div class="sk" style="width:120px;height:18px;margin-top:4px"></div>
        ${[1, 2, 3].map(() => `<div class="sk" style="height:40px;margin-top:16px"></div>`).join("")}</div>
        <span class="sr-only" role="status">Loading Q's work</span></div>`;
    if (S.state === "error")
      return `${composer()}<div class="section"><div class="error-state" role="alert">
        <div class="head">${ic("alert")}<span>Q's work couldn't load.</span></div>
        <p class="t-body-sm muted">Nothing was changed. Anything waiting for your yes is still waiting.</p>
        <button class="btn btn-secondary" style="margin-top:10px" data-retry>${ic("retry", "sm")} Try again</button>
      </div></div>`;
    if (S.state === "empty")
      return `<div style="max-width:720px">${composer()}
        <div class="calm">
          <p class="t-body">Nothing running, and nothing waiting on you.</p>
          <p class="t-body-sm faint" style="margin-bottom:12px">Give Q something to look after, for example:</p>
          <button class="q-prompt" data-prompt>${qMark()}<span>${
            S.role === "founder"
              ? "Prepare me for Tuesday's call with Copperline Capital"
              : "Brief me on Ledgerfold before Thursday's call"
          }</span></button>
        </div></div>`;
    const second = SECOND[S.role];
    const n = needs();
    return `<div class="tasks-grid"><div>
      ${composer()}
      <section class="section" aria-labelledby="needs">
        <h2 class="section-head t-title-sm" id="needs">Needs you <span class="n num" data-count>${n}</span></h2>
        <div data-approval-slot>${approvalCard()}</div>
        <ul class="rows" style="margin-top:12px;border-top:0">
          <li class="row"><div class="lead">${ic("alert", "sm")}</div><div class="body"><div class="title">${second.title}</div><div class="meta">${second.meta}</div></div><button class="btn btn-secondary">Review</button></li>
        </ul>
      </section>
      <section class="section" aria-labelledby="running">
        <h2 class="section-head t-title-sm" id="running">In progress <span class="n num">2</span></h2>
        <ul class="rows">
          ${RUNNING[S.role]
            .map(
              (r) =>
                `<li class="row"><div class="lead">${r.watch ? '<span class="dot positive" aria-hidden="true"></span>' : qMark("glow", true)}</div><div class="body"><div class="title">${r.t}</div><div class="meta">${r.m}</div>${
                  r.p ? `<div class="progress" role="progressbar" aria-valuenow="${r.p}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><span style="width:${r.p}%"></span></div>` : ""
                }</div>${
                  r.watch
                    ? '<span class="state">Watching</span><button class="btn btn-quiet">Change</button>'
                    : `<button class="btn btn-quiet">${ic("stop", "sm")} Stop</button>`
                }</li>`,
            )
            .join("")}
        </ul>
      </section>
      <section class="section" aria-labelledby="done">
        <h2 class="section-head t-title-sm" id="done">Done this week <span class="n num" data-done-n>${S.approved === "sent" ? 11 : 10}</span></h2>
        <ul class="rows" data-done>${doneRows()}</ul>
        <a class="link" href="#">Show 6 more</a>
      </section>
    </div>
    <aside class="rail">
      <div class="rail-block">
        <h2 class="t-title-sm">Q suggests</h2>
        <p class="t-body-sm faint" style="margin:0">From your own account. Nothing starts until you say so.</p>
        <ul class="suggest">${SUGGEST[S.role]
          .map((s) => `<li><button>${qMark()}<span>${s}</span>${ic("right", "sm")}</button></li>`)
          .join("")}</ul>
      </div>
      <div class="rail-block">
        <h2 class="t-title-sm" style="margin-bottom:8px">This month</h2>
        <div class="stat-line"><span class="muted">Credits used</span><span class="num">212 of 600</span></div>
        <div class="stat-line"><span class="muted">Standing instructions</span><span class="num">1</span></div>
        <a class="link" href="#">See usage</a>
      </div>
    </aside></div>`;
  }

  // ---- Documents ----
  const DOCS = [
    { t: "Ledgerfold: seed round brief", m: "Made by Q · 15 Oct", q: 1, k: "doc" },
    { t: "Studio Ekun deck v4", m: "Deck · 18 slides · 5 Oct", k: "slide" },
    { t: "Kestrel Grid financial model", m: "Spreadsheet · 2.1 MB · 4 Oct", k: "sheet" },
    { t: "Comparison: Kestrel Grid and four peers", m: "Made by Q · 14 Oct", q: 1, k: "doc" },
    { t: "Atlas Health Partners: fund III mandate", m: "PDF · 640 KB · 2 Oct", k: "doc" },
    { t: "Marrow Labs: term sheet draft", m: "Word · 88 KB · 1 Oct", k: "doc" },
    { t: "Tidewater Freight: margin evidence", k: "writing" },
    { t: "Weekly pipeline digest, 12 Oct", m: "Made by Q · 12 Oct", q: 1, k: "doc" },
  ];
  const thumb = (k) => {
    if (k === "slide")
      return '<div class="paper slide"><i class="h"></i><i style="width:80%"></i><i style="width:60%"></i></div>';
    if (k === "sheet")
      return `<div class="paper cells">${"<i></i>".repeat(28)}</div>`;
    if (k === "writing")
      return `<div class="writing">${qMark("glow", true)}<span>Q is writing this</span></div>`;
    return '<div class="paper"><i class="h"></i><i></i><i style="width:92%"></i><i style="width:84%"></i><i></i><i style="width:60%"></i><i style="width:88%"></i></div>';
  };
  function documentsPanel() {
    return `<div class="toolbar">
        <label class="search">${ic("search", "sm")}<span>Search documents</span></label>
        <span class="select">Recent ${ic("down", "sm")}</span>
        <div class="seg" role="group" aria-label="View"><button aria-pressed="true" aria-label="Grid">${ic("grid", "sm")}</button><button aria-pressed="false" aria-label="List">${ic("list", "sm")}</button></div>
        <span class="spacer"></span>
        <button class="btn btn-primary">${ic("upload", "sm")} Upload</button>
      </div>
      <div class="seg doc-filter" role="group" aria-label="Show"><button aria-pressed="true">All <span class="num faint">24</span></button><button aria-pressed="false">Uploaded</button><button aria-pressed="false">Made by Q</button></div>
      <div class="doc-grid">${DOCS.map(
        (d, i) =>
          `<button class="doc" ${i === 0 ? "data-open-doc" : ""}><div class="doc-thumb">${thumb(d.k)}</div><div class="doc-title">${d.t}</div><div class="doc-meta">${
            d.k === "writing" ? "Started 4 min ago" : d.q ? `<span class="by-q">Made by Q</span> · ${d.m.split(" · ")[1]}` : d.m
          }</div></button>`,
      ).join("")}</div>`;
  }
  function readerSheet() {
    return `<div class="scrim" data-scrim></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Ledgerfold: seed round brief" data-sheet>
      <div class="sheet-head">
        <div class="body"><div class="t-title-sm" style="font-size:17px">Ledgerfold: seed round brief</div><div class="t-caption faint">Made by Q for Atlas Health Partners · 15 Oct 2026 · 4 pages</div></div>
        <button class="btn btn-secondary">${qMark()} Ask Q about it</button>
        <button class="btn btn-icon btn-quiet" aria-label="Download">${ic("download")}</button>
        <button class="btn btn-icon btn-quiet" aria-label="Close" data-close>${ic("x")}</button>
      </div>
      <div class="sheet-body"><article class="page-doc">
        <p class="t-caption faint" style="margin-bottom:6px">Brief · prepared by Q</p>
        <h3>Ledgerfold: seed round</h3>
        <p style="margin-top:8px">Ledgerfold builds reconciliation software for mid-sized logistics firms. Raising £2.5m seed; first close targeted for December.</p>
        <h4>What the evidence says</h4>
        <table>
          <tr><th>Fact</th><th>Value</th><th>Basis</th></tr>
          <tr><td>Annual recurring revenue</td><td class="num">£1.2m</td><td>Founder's claim, supported by March bank statements</td></tr>
          <tr><td>Customers</td><td class="num">31</td><td>Customer list in data room</td></tr>
          <tr><td>Net revenue retention</td><td>Unknown</td><td>Not in any document yet</td></tr>
          <tr><td>Runway</td><td class="num">14 or 11 months</td><td>Deck and model disagree; both kept</td></tr>
        </table>
        <h4>Open questions for Thursday</h4>
        <p>1. How the months 7–12 cohorts behave; the deck stops at month 6.</p>
        <p>2. Which of the two runway figures reflects the current hiring plan.</p>
        <p>3. Concentration: the top three customers' share of revenue.</p>
        <h4>Sources</h4>
        <p class="t-caption">Ledgerfold deck v3 (12 Sep) · Ledgerfold model (30 Sep) · Bank statements, Jan–Mar · Call notes, 2 Oct</p>
      </article></div>
    </section>`;
  }

  // ---- Pitch (founder) ----
  function pitchPanel() {
    if (S.role !== "founder")
      return `<p class="muted">Pitches are made by founders.</p>`;
    return `<div class="pitch-grid">
      <section aria-labelledby="pv">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="t-title-sm" id="pv">Pitch video</h2><span class="state"><span class="dot positive" aria-hidden="true"></span>Live on Discover</span></div>
        <div class="video" style="margin-top:12px"><span class="bar"></span>
          <div class="poster-type">Studio Ekun<small>Two-minute pitch · 2:41 · captions on</small></div>
          <button class="play" aria-label="Play pitch video">${ic("play")}</button>
        </div>
        <div class="media-row">
          <div class="media-thumb"><span>Product demo · 1:12</span></div>
          <div class="media-thumb"><span>Team · 0:48</span></div>
          <button class="new-media">${ic("upload", "sm")} New video</button>
        </div>
        <div class="notice" style="margin-top:28px">${ic("alert")}<div><p><strong>Your deck says 14 months of runway; your model says 11.</strong></p><p class="muted" style="margin-top:2px">Both are kept until you choose. Investors see the figure you confirm.</p><a class="link" href="#">Review</a></div></div>
      </section>
      <section aria-labelledby="dk">
        <h2 class="t-title-sm" id="dk">Deck</h2>
        <div class="deck" style="margin-top:12px">
          <div class="deck-thumb">Studio Ekun<br/><span style="font-size:12px;opacity:.7;font-family:var(--cq-font-ui)">Seed, 2026</span></div>
          <div><div class="title" style="font-weight:500">Seed deck v4</div><div class="t-body-sm muted">18 slides · updated 5 Oct</div>
            <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-secondary">Open</button><button class="btn btn-quiet">Replace</button></div></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:36px"><h2 class="t-title-sm">Data room</h2><a class="link" href="#">Manage access</a></div>
        <p class="t-body-sm muted" style="margin:0">Shared with 3 investors. Nothing leaves without your yes.</p>
        <ul class="rows folder-rows" style="margin-top:8px">
          ${[
            ["Financials", "6 files · updated 3 Oct", "2 investors"],
            ["Product & tech", "3 files · updated 28 Sep", "2 investors"],
            ["Legal", "4 files · updated 19 Sep", "Only you"],
            ["Team", "2 files · updated 12 Sep", "Only you"],
          ]
            .map(
              ([f, m, a]) =>
                `<li class="row">${ic("folder")}<div class="body"><div class="title" style="font-size:14px">${f}</div><div class="meta">${m}</div></div><span class="kind">${a}</span></li>`,
            )
            .join("")}
        </ul>
      </section>
    </div>`;
  }

  // ---- Rehearsals ----
  function rehearsalsPanel() {
    const people =
      S.role === "founder"
        ? [
            ["CC", "Copperline Capital", "Call on Tue 20 Oct", "2 rehearsals"],
            ["HV", "Halden Ventures", "No call booked", "1 rehearsal"],
            ["AH", "Atlas Health Partners", "Call on Fri 23 Oct", "Not rehearsed yet"],
          ]
        : [
            ["LF", "Ledgerfold", "Call on Thu 22 Oct", "2 rehearsals"],
            ["SE", "Studio Ekun", "Call on Fri 23 Oct", "1 rehearsal"],
            ["KG", "Kestrel Grid", "No call booked", "Not rehearsed yet"],
          ];
    const past =
      S.role === "founder"
        ? [
            ["15 Oct", "Copperline Capital", "18 min", 74, "+9 since the last one"],
            ["12 Oct", "Copperline Capital", "21 min", 65, "First with them"],
            ["8 Oct", "Halden Ventures", "16 min", 70, "First with them"],
          ]
        : [
            ["16 Oct", "Ledgerfold", "22 min", 78, "+6 since the last one"],
            ["13 Oct", "Ledgerfold", "19 min", 72, "First with them"],
            ["9 Oct", "Studio Ekun", "14 min", 69, "First with them"],
          ];
    return `<div class="allow"><span>4 of 6 rehearsals left this month</span><span class="meter" aria-hidden="true"><span style="width:66%"></span></span><a class="link" href="#">See your plan</a></div>
      <section class="section" aria-labelledby="pw"><h2 class="section-head t-title-sm" id="pw">Practise with</h2>
        <ul class="rows">${people
          .map(
            ([i, n, c, d]) =>
              `<li class="row"><span class="avatar">${i}</span><div class="body"><div class="title">${n}</div><div class="meta">${c} · ${d}</div></div><button class="btn btn-secondary">${ic("rehearse", "sm")} Rehearse</button></li>`,
          )
          .join("")}</ul></section>
      <section class="section" aria-labelledby="pr"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="section-head t-title-sm" id="pr" style="margin:0">Past rehearsals</h2><span class="select">Everyone ${ic("down", "sm")}</span></div>
        <ul class="rows" style="margin-top:12px">${past
          .map(
            ([d, n, len, s, ch]) =>
              `<li class="row"><span class="when" style="min-width:52px">${d}</span><div class="body"><div class="title">${n}</div><div class="meta">${len} · Finished</div></div><span class="delta">${ch}</span><span class="score">${s}<small> / 100</small></span><a class="link" href="#" style="padding:0 4px">Open</a></li>`,
          )
          .join("")}</ul></section>`;
  }

  // ---- The Q Daily ----
  function dailyPanel() {
    const w = WHO[S.role];
    return `<div class="paper-daily">
      <header class="masthead"><h2>The Q Daily</h2><p>Saturday 17 October 2026 · Edition 212 · For ${w.org}</p></header>
      <article class="lead-story">
        <div><h3 class="headline">Hospital groups slow software spending as reimbursement rules tighten</h3>
          <p class="standfirst">Three regional operators have paused new procurement until the spring. Two companies in your pipeline sell into the same buyers; Q lists which contracts renew first.</p>
          <p class="src">3 sources · <a href="#">Health Capital Review</a>, <a href="#">Northfield Ledger</a>, an operator's filing</p></div>
        <div style="display:grid;gap:14px;align-content:start">
          <p class="why">Why you're seeing this: you follow digital health, and Studio Ekun and Kestrel Grid sell to these buyers.</p>
          <a class="link" href="#">Ask Q what this means for Studio Ekun</a>
        </div>
      </article>
      <div class="stories">
        ${[
          ["Ledgerfold names a finance lead from a listed logistics firm", "The hire closes the gap Q flagged in your brief on Tuesday.", "1 source · company announcement"],
          ["Seed rounds in climate logistics took longer to close this quarter", "Median time to first close rose from 11 to 15 weeks across 42 rounds.", "2 sources · Northfield Ledger, Capital Q network"],
          ["Marrow Labs publishes its second clinical data readout", "Readout covers 60 patients; the endpoint matches the one in its deck.", "1 source · company filing"],
        ]
          .map(
            ([h, p, s]) =>
              `<article class="story"><h3 class="headline">${h}</h3><p>${p}</p><p class="src">${s}</p></article>`,
          )
          .join("")}
      </div>
      <a class="link" href="#" style="margin-top:12px">Earlier editions</a>
    </div>`;
  }

  const PANELS = {
    tasks: tasksPanel,
    documents: documentsPanel,
    pitch: pitchPanel,
    rehearsals: rehearsalsPanel,
    daily: dailyPanel,
  };

  // ---- phone chrome ----
  function bottomNav() {
    const workTab =
      S.nav === "b"
        ? `<a href="#" class="bn" aria-current="page">${ic("work")}<span>Work</span>${needs() ? `<span class="badge-n num" data-count>${needs()}</span>` : ""}</a>`
        : `<button class="bn" data-more ${S.tab ? 'aria-current="page"' : ""}>${ic("more")}<span>More</span>${needs() ? `<span class="badge-n num" data-count>${needs()}</span>` : ""}</button>`;
    return `<nav class="bottom-nav" aria-label="Primary">
      <a href="#" class="bn">${ic("compass")}<span>Discover</span></a>
      <a href="#" class="bn">${ic("explore")}<span>Explore</span></a>
      <a href="#" class="bn">${qMark("glow")}<span>Q</span></a>
      <a href="#" class="bn">${ic("users")}<span>CRM</span></a>
      ${workTab}
    </nav>`;
  }
  function moreSheet() {
    return `<div class="scrim m-sheet-scrim" data-mscrim></div>
    <div class="m-sheet-clip"><section class="m-sheet" role="dialog" aria-label="More" data-msheet>
      <div class="grab" aria-hidden="true"></div><h2>More</h2>
      <a href="#" class="m-item first">${ic("work")}<div class="body">Work<div class="sub">Tasks, documents${S.role === "founder" ? ", pitch" : ""}, rehearsals, the Daily</div></div><span class="n num">${needs()} waiting</span></a>
      <a href="#" class="m-item">${ic("user")}<div class="body">Profile</div>${ic("right", "sm")}</a>
      <a href="#" class="m-item">${ic("settings")}<div class="body">Settings</div>${ic("right", "sm")}</a>
      <a href="#" class="m-item">${ic("gauge")}<div class="body">Usage</div>${ic("right", "sm")}</a>
      <div class="m-theme"><span>Appearance</span><div class="seg" role="group"><button aria-pressed="true">Light</button><button aria-pressed="false">Device</button><button aria-pressed="false">Dark</button></div></div>
    </section></div>`;
  }

  // ---- render ----
  const app = document.getElementById("app");
  function render() {
    if (S.view === "compare") return renderCompare();
    const w = WHO[S.role];
    app.innerHTML = `<div class="shell">${sidebar()}
      <main class="main m-body">
        <header class="m-head"><span class="brand">Capital Q</span><div class="tools"><button class="sb-icon" aria-label="Notices">${ic("bell")}</button><button class="sb-icon" aria-label="Profile"><span class="avatar">${w.initials}</span></button></div></header>
        <div class="page">
          <div class="page-head"><div><h1 class="t-title-lg">Work</h1></div></div>
          ${tabStrip()}
          <div class="panel" data-panel role="region" aria-label="${S.tab}">${PANELS[S.tab]()}</div>
        </div>
      </main>
      ${bottomNav()}
    </div>
    ${params.get("reader") === "1" || S.tab === "documents" ? readerSheet() : ""}
    ${moreSheet()}
    <div class="caption" data-caption></div>`;
    placeInk(false);
    bind();
    if (params.get("reader") === "1") openReader(true);
    if (params.get("sheet") === "more") openMore(true);
  }

  function renderCompare() {
    document.title = "Sidebar: before and after";
    app.innerHTML = `<div class="stage">
      <div class="stage-title"><h1 class="t-title-lg">Sidebar, before and after</h1><span class="muted">${S.role === "founder" ? "Founder" : "Investor"} · light · Black and gold</span></div>
      <div class="compare">
        <div class="compare-col"><h2>Today: a Workspace folder</h2>${sidebar("before")}</div>
        <div class="compare-col"><h2>Proposed: one Work entry</h2>${sidebar("after")}</div>
        <div class="compare-notes">
          <div><div class="big-n">${S.role === "founder" ? "12 → 7" : "10 → 7"}</div><p>entries in the sidebar, counting Profile and Settings</p></div>
          <p><strong>Discover · Explore · Q · CRM · Work.</strong> Everything else that was in Workspace becomes a tab on the Work page.</p>
          <p><strong>No page moves.</strong> /work, /documents, ${S.role === "founder" ? "/pitch, " : ""}/rehearsals and /daily keep their addresses, so Q and voice still open each one directly.</p>
          <p><strong>The count stays.</strong> What waits on you shows beside Work, as it does today.</p>
        </div>
      </div></div><div class="caption" data-caption></div>`;
  }

  function switchTab(id) {
    if (id === S.tab) return;
    const panel = document.querySelector("[data-panel]");
    S.tab = id;
    document
      .querySelectorAll("[data-tab]")
      .forEach((a) =>
        a.dataset.tab === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"),
      );
    placeInk(true);
    const reduced =
      root.dataset.motion === "reduced" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const swap = () => {
      panel.innerHTML = PANELS[id]();
      panel.setAttribute("aria-label", id);
      panel.classList.remove("out", "in");
      if (!reduced) {
        panel.getBoundingClientRect();
        panel.classList.add("in");
      }
      if (id === "documents" && !document.querySelector("[data-sheet]")) {
        document.body.insertAdjacentHTML("beforeend", readerSheet());
      }
      bindPanel();
    };
    if (reduced) swap();
    else {
      panel.classList.add("out");
      setTimeout(swap, 90);
    }
    const t = TABS.find((t) => t.id === id);
    history.replaceState(null, "", `?${new URLSearchParams({ ...Object.fromEntries(params), tab: id })}`);
    document.title = `${t.label} · Work`;
  }

  function openReader(instant) {
    const sheet = document.querySelector("[data-sheet]");
    const scrim = document.querySelector("[data-scrim]");
    if (!sheet) return;
    if (instant) {
      sheet.style.transition = scrim.style.transition = "none";
    }
    scrim.classList.add("open");
    sheet.classList.add("open");
  }
  function closeReader() {
    document.querySelector("[data-sheet]")?.classList.remove("open");
    document.querySelector("[data-scrim]")?.classList.remove("open");
  }
  function openMore(instant) {
    const sheet = document.querySelector("[data-msheet]");
    const scrim = document.querySelector("[data-mscrim]");
    if (instant) sheet.style.transition = scrim.style.transition = "none";
    sheet.classList.add("open");
    scrim.classList.add("open");
  }

  function closeMore() {
    document.querySelector("[data-msheet]")?.classList.remove("open");
    document.querySelector("[data-mscrim]")?.classList.remove("open");
  }

  function setCounts() {
    const n = needs();
    document.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = n;
    });
  }

  function approve() {
    if (S.approved) return;
    S.approved = "pending";
    const slot = document.querySelector("[data-approval-slot]");
    slot.innerHTML = approvalCard();
    // Shown at once: the pending state. "Approved" only after the server
    // confirms (approvals are consequential; never optimistic).
    setTimeout(() => {
      S.approved = "done";
      slot.innerHTML = approvalCard();
      setCounts();
    }, 700);
    setTimeout(() => {
      S.approved = "sent";
      const a = APPROVAL[S.role];
      slot.innerHTML = "";
      const list = document.querySelector("[data-done]");
      list.insertAdjacentHTML(
        "afterbegin",
        `<li class="row fresh" data-fresh><div class="lead">${ic("check", "sm faint")}</div><div class="body"><div class="title">${a.title.replace("Send ", "Sent ").replace("Share ", "Shared ")}</div><div class="meta">Approved by you · just now</div></div><span class="kind">${S.role === "founder" ? "Access" : "Outreach"}</span><span class="when" style="min-width:40px">Now</span><a class="link" href="#" style="padding:0 4px">Open</a></li>`,
      );
      document.querySelector("[data-done-n]").textContent = 11;
      requestAnimationFrame(() =>
        setTimeout(() => document.querySelector("[data-fresh]")?.classList.add("settled"), 400),
      );
    }, 2600);
  }

  function bindPanel() {
    const close = document.querySelector("[data-close]");
    const scrim = document.querySelector("[data-scrim]");
    if (close) close.onclick = closeReader;
    if (scrim) scrim.onclick = closeReader;
    document.querySelector("[data-approve]")?.addEventListener("click", approve);
    document.querySelector("[data-open-doc]")?.addEventListener("click", () => openReader(false));
    document.querySelector("[data-retry]")?.addEventListener("click", () => {
      S.state = "loading";
      document.querySelector("[data-panel]").innerHTML = tasksPanel();
      setTimeout(() => {
        S.state = "ready";
        const p = document.querySelector("[data-panel]");
        p.innerHTML = tasksPanel();
        p.classList.remove("in");
        p.getBoundingClientRect();
        p.classList.add("in");
        setCounts();
        bindPanel();
      }, 1200);
    });
    document.querySelector("[data-prompt]")?.addEventListener("click", (e) => {
      const input = document.getElementById("task");
      input.value = e.currentTarget.querySelector("span").textContent;
      input.focus();
    });
  }
  function bind() {
    document.querySelectorAll("[data-tab]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        switchTab(a.dataset.tab);
      }),
    );
    document.querySelector("[data-more]")?.addEventListener("click", () => openMore(false));
    document.querySelector("[data-mscrim]")?.addEventListener("click", closeMore);
    document.querySelectorAll("a[href='#']").forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));
    bindPanel();
    window.addEventListener("resize", () => placeInk(false));
  }

  // Hooks for the capture script.
  window.cq = {
    switchTab,
    openReader,
    closeReader,
    openMore,
    closeMore,
    approve,
    setCaption(text, sub) {
      const el = document.querySelector("[data-caption]");
      if (el) el.innerHTML = text ? `${text}${sub ? `<small>${sub}</small>` : ""}` : "";
    },
  };
  render();
})();
