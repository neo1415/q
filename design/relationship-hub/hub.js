/*
 * Relationship Hub: clickable design prototype (Lane B, design phase only).
 *
 * SIMULATED: everything here runs in the browser on fictional data. There are
 * no network calls. The Q control layer imitates the real contract shape
 * (packages/contracts/src/q/ui-act.ts: a semantic control id, a typed act, a
 * receipt) and shows four receipt states: requested → acknowledged →
 * completed | failed. "Completed" is reported only after the prototype reads
 * the control's state back (aria-selected, aria-pressed, a visible element);
 * if the read-back fails, the act is reported as failed, never "Done".
 */
(() => {
  "use strict";
  const D = window.HUB_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- icons (simple strokes, no AI imagery) ---------------- */
  const P = {
    home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5l-2 5-5 2 2-5z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    bank: "M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18",
    users:
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
    hub: "M4 5h16M4 12h10M4 19h6M18 15l3 3-3 3",
    gate: "M4 21V8l8-5 8 5v13M9 21v-6h6v6",
    work: "M4 7h16v12H4zM9 7V4h6v3",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
    lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
    share: "M8 12h8M12 8l4 4-4 4M4 4v16",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    down: "M12 4v12M7 11l5 5 5-5M5 20h14",
    table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
    board: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
    back: "M15 6l-6 6 6 6",
    check: "M5 12l4 4 10-10",
    x: "M6 6l12 12M18 6L6 18",
    clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    msg: "M4 5h16v11H8l-4 4z",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  };
  const icon = (n) =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const qMark = (working) =>
    `<span class="aperture${working ? " working" : ""}" aria-hidden="true"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="var(--cq-surface-raised)"/><g class="ring"><circle cx="18" cy="18" r="10" fill="none" stroke="var(--cq-q-light)" stroke-width="3" stroke-dasharray="52 12"/></g><path d="M24 24l5 5" stroke="var(--cq-q-light)" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="18" r="4" fill="var(--cq-q-core)" stroke="var(--cq-q-light)" stroke-width="1"/></svg></span>`;
  const fict = `<span class="fictional">fictional</span>`;
  const q = (id) => `data-q="${id}"`;

  /* ---------------- state ---------------- */
  const S = {
    role: "investor",
    area: "overview",
    recordId: null,
    recordTab: "overview",
    view: "table",
    saved: "active",
    stage: null,
    search: "",
    docPage: 1,
    transcriptAt: null,
    workId: "w1",
    gateqSel: "g1",
    approval: "OPEN", // OPEN | APPROVED | SENDING | SENT | REJECTED
    qOpen: false,
    qWorking: false,
    qLog: [],
    qSay: null,
    drawer: null,
    compare: false,
    returnTo: null,
  };

  const INV_AREAS = [
    ["overview", "Overview"],
    ["pipeline", "Pipeline"],
    ["gateq", "GateQ"],
    ["meetings", "Meetings & activity"],
    ["portfolio", "Portfolio"],
    ["reports", "Reports"],
  ];
  const FND_AREAS = [
    ["overview", "Overview"],
    ["investors", "Investors"],
    ["fundraising", "Fundraising"],
    ["requests", "Meetings & requests"],
    ["updates", "Updates"],
    ["reports", "Reports"],
  ];
  const INV_TABS = [
    ["overview", "Overview"],
    ["evidence", "Intelligence & evidence"],
    ["gateq", "GateQ dossier"],
    ["meetings", "Meetings"],
    ["documents", "Documents"],
    ["notes", "Messages, notes & tasks"],
    ["diligence", "Diligence"],
    ["work", "Q Work"],
    ["history", "History"],
  ];
  const FND_TABS = [
    ["overview", "Overview"],
    ["meetings", "Meetings"],
    ["requests", "Requests"],
    ["documents", "Shared documents"],
    ["messages", "Messages"],
    ["intel", "Q intelligence"],
    ["history", "History"],
  ];

  const company = (id) => D.companies.find((c) => c.id === id);
  const investor = (id) => D.investors.find((c) => c.id === id);
  const sw = (s) => D.stateWords[s] || s;
  const stateLabel = (s) => {
    const cls =
      s === "INVESTED"
        ? "pos"
        : s === "IN_DILIGENCE" || s === "MEETING_HELD"
          ? "accent"
          : s === "PAUSED"
            ? "warn"
            : "";
    return `<span class="label ${cls}">${sw(s)}</span>`;
  };

  /* ---------------- hash routing (deep links for screenshots) ---------------- */
  function toHash() {
    const parts = [S.role, S.area];
    if (S.area === "record") parts.push(S.recordId, S.recordTab);
    if (S.area === "work") parts.push(S.workId);
    let h = "#" + parts.join("/");
    const qs = [];
    if (S.area === "pipeline" || S.area === "investors")
      qs.push("view=" + S.view);
    if (S.recordTab === "documents" && S.area === "record")
      qs.push("page=" + S.docPage);
    if (S.transcriptAt && S.area === "record")
      qs.push("t=" + S.transcriptAt.replace(":", ""));
    if (qs.length) h += "?" + qs.join("&");
    if (location.hash !== h)
      history.replaceState(null, "", location.pathname + location.search + h);
  }
  function fromHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const [path, qs] = raw.split("?");
    const [role, area, a, b] = path.split("/");
    if (role === "investor" || role === "founder") S.role = role;
    if (area) S.area = area;
    if (S.area === "record") {
      S.recordId = a || (S.role === "investor" ? "halden" : "northgate");
      S.recordTab = b || "overview";
    }
    if (S.area === "work") S.workId = a || "w1";
    const p = new URLSearchParams(qs || "");
    if (p.get("view")) S.view = p.get("view");
    if (p.get("page")) S.docPage = Number(p.get("page"));
    if (p.get("t"))
      S.transcriptAt = p.get("t").replace(/(\d\d)(\d\d)/, "$1:$2");
    if (p.get("q") === "open") S.qOpen = true;
    if (p.get("drawer")) S.drawer = p.get("drawer");
    if (p.get("compare")) S.compare = true;
  }

  /* ---------------- shell ---------------- */
  function sidebar() {
    const hubLabel =
      S.role === "investor" ? "Investment Hub" : "Fundraising Hub";
    const inHub = !["work"].includes(S.area);
    const item = (ic, label, active, act, hint = "") =>
      `<button class="nav-item" ${active ? 'aria-current="page"' : ""} data-action="${act}">${icon(ic)}<span>${label}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</button>`;
    return `<nav class="sidebar" aria-label="Main">
      <div class="brand">${qMark(false).replace('class="aperture"', 'class="aperture" style="width:26px;height:26px"')}<span>Capital Q</span></div>
      ${item("compass", "Discover", false, "noop")}
      ${item("grid", "Explore", false, "noop")}
      ${item("home", "Q", false, "q-open")}
      ${item("bank", "Capital", false, "noop")}
      ${item("users", "Relationships", S.area === "record", "go:" + (S.role === "investor" ? "pipeline" : "investors"), "→ Hub")}
      <div class="nav-group-label">Workspace</div>
      ${item("hub", hubLabel, inHub && S.area !== "record", "go:overview", "/results")}
      ${S.role === "investor" ? item("gate", "GateQ", false, "go:gateq") : item("gate", "GateQ", false, "noop")}
      ${item("work", "Work", S.area === "work", "work:w1")}
      ${item("file", "Documents", false, "noop")}
      <div class="sidebar-foot">
        <div class="seg" role="group" aria-label="Theme">${["light", "device", "dark"].map((t) => `<button data-action="theme:${t}" aria-pressed="${themeChoice() === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
        <div class="faint" style="font-size:12px;padding:0 4px">${S.role === "investor" ? D.viewerInvestor.person + " · " + D.viewerInvestor.org : D.viewerFounder.person + " · " + D.viewerFounder.company} ${fict}</div>
      </div>
    </nav>`;
  }
  function bottomNav() {
    const b = (ic, label, act, cur) =>
      `<button data-action="${act}" ${cur ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></button>`;
    return `<nav class="bottom-nav" aria-label="Main">${b("compass", "Discover", "noop")}${b("bank", "Capital", "noop")}${b("home", "Q", "q-open")}${b("hub", "Hub", "go:overview", S.area !== "work")}${b("more", "More", "noop")}</nav>`;
  }
  function areaTabs() {
    const list = S.role === "investor" ? INV_AREAS : FND_AREAS;
    return `<div class="tabs" role="tablist" aria-label="Hub areas" ${q("list.hub-areas")}>${list.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${S.area === k}" data-action="go:${k}" ${q("tab.hub-" + k)}>${l}</button>`).join("")}</div>`;
  }
  function hubHead() {
    const inv = S.role === "investor";
    return `<div class="page-head"><div><h1>${inv ? "Investment Hub" : "Fundraising Hub"}</h1><div class="sub">${inv ? `${D.viewerInvestor.org} ${fict} · your relationships, GateQ and Q's work in one place` : `${D.viewerFounder.company} ${fict} · your round, your investors and what they need from you`}</div></div>
      <div class="actions"><span class="label outline">${icon("clock")}This month</span><button class="btn sm" data-action="go:reports" ${q("button.hub-reports")}>${icon("down")}Reports</button></div></div>`;
  }

  /* ---------------- investor: overview ---------------- */
  function briefing(lines, scope) {
    return `<section class="briefing" ${q("section.briefing")} aria-label="Q briefing">${qMark(false)}<div>${lines.map((l) => `<p>${l}</p>`).join("")}<div class="scope">${icon("lock").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} Briefing from records you are allowed to see. ${scope} <span class="fictional">simulated</span></div></div><div><button class="btn sm" data-action="q-investigate">Investigate further</button></div></section>`;
  }
  function invOverview() {
    const counts = D.pipelineOrder.map((s) => [
      s,
      D.companies.filter((c) => c.state === s).length,
    ]);
    return `${briefing(
      [
        "<strong>Three things need you.</strong> Halden Grid asked for a diligence decision by 23 Oct. Q's follow-up to them is waiting for your approval. Corvid Health has had no decision since its 7 Oct meeting.",
        "Since Monday, 2 GateQ applications arrived that fit your mandate, and Kestrel Robotics moved into diligence.",
      ],
      "Read from the Results read and 61 relationship events.",
    )}
    <div class="stages" style="--n:5" ${q("list.stage-strip")}>${counts.map(([s, n]) => `<button class="stage" data-action="stage:${s}" ${q("filter.stage-" + s.toLowerCase())}><div class="n">${n}</div><div class="l">${sw(s)}</div></button>`).join("")}</div>
    <p class="faint" style="font-size:12px;margin:6px 2px 0">Stages are derived from each relationship's event history. Picking one opens the pipeline filtered to it.</p>
    <div class="grid two" style="margin-top:20px">
      <section class="panel" ${q("section.needs-you")}><header><h2>Needs you</h2><span class="faint">3</span></header><div class="rows">
        ${needRow("halden", "Decide on diligence for Halden Grid", "Founder asked for a decision by 23 Oct · meeting 9 Oct", "Open record", "open:halden:overview")}
        ${needRow("halden", "Approve Q's follow-up to Halden Grid", "Draft ready since yesterday 16:12 · nothing sent", "Review draft", "work:w2")}
        ${needRow("corvid", "Decide next step for Corvid Health", "Meeting held 7 Oct · 7 days without a decision", "Open record", "open:corvid:overview")}
      </div></section>
      <section class="panel"><header><h2>Coming up</h2></header><div class="rows">
        <div class="row">${icon("cal")}<div class="grow"><div class="title">Kestrel Robotics: customer reference call</div><div class="meta">Thu 16 Oct, 11:00 · Jonas Lind</div></div></div>
        <div class="row">${icon("cal")}<div class="grow"><div class="title">Nimbus Ledger: first meeting</div><div class="meta">Fri 17 Oct, 15:30 · Q is preparing a brief</div></div></div>
        <div class="row">${icon("clock")}<div class="grow"><div class="title">Brightwater Analytics: quarterly update due</div><div class="meta">15 Oct · portfolio</div></div></div>
      </div></section>
    </div>
    <div class="grid two" style="margin-top:20px">
      <section class="panel"><header><h2>Recent activity</h2><span class="right"><button class="btn sm ghost" data-action="go:meetings">All activity</button></span></header><div class="rows">
        ${actRow("Kestrel Robotics", "Moved to In diligence", "Diligence started by Jonas Lind · 10 Oct", "share")}
        ${actRow("Halden Grid", "Shared Financial model v3", "Relationship-shared · 10 Oct 08:14", "file")}
        ${actRow("Oriel Payments", "GateQ application, fits", "7 of 7 rules met · today 09:12", "gate")}
        ${actRow("Halden Grid", "Meeting held", "9 Oct, 52 min, recorded with consent", "cal")}
      </div></section>
      <section class="panel"><header><h2>Q's work</h2><span class="right"><button class="btn sm ghost" data-action="work:w1">Open Work</button></span></header><div class="rows">
        ${D.work.map((w) => `<div class="row link" data-action="work:${w.id}" ${q("item.work-" + w.id)}>${qMark(w.state === "RUNNING").replace('class="aperture', 'style="width:24px;height:24px" class="aperture')}<div class="grow"><div class="title">${w.title}</div><div class="meta">${workWord(w.state)}</div></div></div>`).join("")}
      </div></section>
    </div>`;
  }
  const workWord = (s) =>
    ({
      RUNNING: "Running · step 3 of 4",
      NEEDS_APPROVAL: "Needs your approval",
      DONE: "Completed Mon 08:01",
    })[s];
  function needRow(id, t, m, cta, act) {
    const c = company(id);
    return `<div class="row"><span class="avatar sm">${c.initials}</span><div class="grow"><div class="title">${t}</div><div class="meta">${m}</div></div><button class="btn sm" data-action="${act}">${cta}</button></div>`;
  }
  function actRow(who, what, meta, ic) {
    return `<div class="row">${icon(ic)}<div class="grow"><div class="title">${who}: ${what}</div><div class="meta">${meta}</div></div></div>`;
  }

  /* ---------------- investor: pipeline ---------------- */
  function filtered() {
    let list = D.companies.filter((c) => c.state !== "PASSED");
    if (S.saved === "mine")
      list = list.filter((c) => c.owner === D.viewerInvestor.person);
    if (S.saved === "diligence")
      list = list.filter((c) => c.state === "IN_DILIGENCE");
    if (S.saved === "gateq") list = list.filter((c) => c.source === "GateQ");
    if (S.saved === "active") list = list.filter((c) => c.state !== "INVESTED");
    if (S.stage) list = list.filter((c) => c.state === S.stage);
    if (S.search)
      list = list.filter((c) =>
        c.name.toLowerCase().includes(S.search.toLowerCase()),
      );
    return list;
  }
  function pipelineToolbar(kind) {
    const saved =
      kind === "inv"
        ? [
            ["active", "All active"],
            ["mine", "My relationships"],
            ["diligence", "In diligence"],
            ["gateq", "From GateQ"],
          ]
        : [
            ["active", "All active"],
            ["mine", "Need my reply"],
            ["diligence", "In diligence"],
            ["gateq", "Committed"],
          ];
    const stages =
      kind === "inv"
        ? D.pipelineOrder
        : [
            "INTEREST_EXPRESSED",
            "CONNECTED",
            "MEETING_HELD",
            "IN_DILIGENCE",
            "INVESTED",
          ];
    return `<div class="views" role="tablist" aria-label="Saved views" ${q("list.saved-views")}>${saved.map(([k, l]) => `<button class="view" role="tab" aria-selected="${S.saved === k}" data-action="saved:${k}" ${q("tab.view-" + k)}>${l}</button>`).join("")}<button class="view" data-action="toast:Saved views belong to you; a team default needs admin rights (simulated)">+ Save view</button></div>
    <div class="toolbar">
      <label class="search">${icon("search")}<span class="sr">Search</span><input id="pipe-search" placeholder="Search ${kind === "inv" ? "companies" : "investors"}" value="${S.search}" ${q("input.pipeline-search")} /></label>
      <span class="faint" style="font-size:12px">Filter</span>
      ${stages.map((s) => `<button class="chip" aria-pressed="${S.stage === s}" data-action="stage:${s}" ${q("filter.stage-" + s.toLowerCase())}>${sw(s)}</button>`).join("")}
      ${S.stage || S.search ? `<button class="btn sm ghost" data-action="clear">Clear</button>` : ""}
      <span class="divider-v"></span>
      <span class="faint" style="font-size:12px">Display</span>
      <div class="seg" role="group" aria-label="Layout" ${q("toggle.pipeline-layout")}><button aria-pressed="${S.view === "table"}" data-action="view:table" ${q("button.layout-table")}>${icon("table").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} Table</button><button aria-pressed="${S.view === "board"}" data-action="view:board" ${q("button.layout-board")}>${icon("board").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} Board</button></div>
    </div>`;
  }
  function invPipeline() {
    const list = filtered();
    const body =
      S.view === "table"
        ? `<div class="table-wrap stack-mobile"><table ${q("list.pipeline")} data-count="${list.length}"><thead><tr><th>Company</th><th>Stage</th><th>Mandate fit</th><th>Evidence</th><th>Owner</th><th>Next action</th><th>Last activity</th></tr></thead><tbody>
        ${list.map((c, i) => `<tr data-action="open:${c.id}:overview" ${q("item.pipeline-" + (i + 1))}><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar sm">${c.initials}</span><div><div class="name">${c.name}</div><div class="sub">${c.sector} · ${c.geo} · ${c.stage}</div></div></div></td><td>${stateLabel(c.state)}</td><td class="hide-m">${c.fit.word}</td><td class="hide-m">${c.quality.word.replace("Evidence: ", "")}</td><td class="hide-m">${c.owner}</td><td class="hide-m">${c.next}</td><td class="num hide-m">${c.last}</td></tr>`).join("")}
        ${list.length === 0 ? `<tr><td colspan="7" class="muted">No relationships match. Clear the filter to see all.</td></tr>` : ""}
      </tbody></table></div>`
        : `<p class="board-note">Columns are derived states. Moving a card opens the action that records the event (for example "Start diligence"); it never edits a stage directly.</p><div class="board" ${q("list.pipeline")}>${D.pipelineOrder
            .map((s) => {
              const items = list.filter((c) => c.state === s);
              return `<div class="col"><h3>${sw(s)} <span class="faint">${items.length}</span></h3>${items.map((c) => `<div class="tile" data-action="open:${c.id}:overview"><div class="name">${c.name}</div><div class="meta">${c.sector} · ${c.owner}</div><div class="next">Next: ${c.next}</div></div>`).join("")}</div>`;
            })
            .join("")}</div>`;
    return `${pipelineToolbar("inv")}${body}<p class="faint" style="font-size:12px;margin-top:10px">${list.length} relationships · one row per canonical company relationship · cursor pagination after 50 rows</p>`;
  }

  /* ---------------- investor: GateQ ---------------- */
  function invGateq() {
    const sel = D.gateq.find((g) => g.id === S.gateqSel);
    const bandCls = (b) =>
      b === "FITS" ? "pos" : b === "PARTIAL" ? "warn" : "";
    return `<div class="grid two">
      <section class="panel"><header><h2>Applications</h2><span class="faint">${D.gateq.length}</span><span class="right faint" style="font-size:12px">Fit is GateQ's rule check, not a judgement of the company</span></header><div class="rows" ${q("list.gateq-applications")}>
        ${D.gateq.map((g) => `<div class="row link" data-action="gsel:${g.id}" ${S.gateqSel === g.id ? 'style="background:var(--cq-surface-subtle)"' : ""}><span class="avatar sm">${g.initials}</span><div class="grow"><div class="title">${g.name}${fict}</div><div class="meta">${g.ask} · ${g.rules}</div></div><span class="label ${bandCls(g.band)}">${g.bandWord}</span><span class="faint" style="font-size:12px;width:80px;text-align:right">${g.when}</span></div>`).join("")}
      </div></section>
      <section class="panel"><header><h2>${sel.name} ${fict}</h2><span class="right"><span class="label ${bandCls(sel.band)}">${sel.bandWord}</span></span></header><div class="body">
        <p class="muted" style="margin-top:0">${sel.ask} · ${sel.rules}</p>
        <div class="section-title" style="margin-top:4px">Rules</div>
        <div class="rows" style="border:1px solid var(--cq-border-subtle);border-radius:var(--cq-radius-md)">
          ${["Stage: Seed to Series A", "Sector: energy, fintech infrastructure", "Geography: EU and UK", "Cheque: EUR 250k–2m", "Revenue evidence provided", "Founders full-time", "No competing portfolio company"].map((r, i) => `<div class="row" style="min-height:40px">${icon(sel.band === "FITS" || i < 5 ? "check" : "x")}<div class="grow">${r}</div><span class="faint" style="font-size:12px">${sel.band === "FITS" || i < 5 ? "Met" : "Not met"}</span></div>`).join("")}
        </div>
        <div class="section-title">Interview with Q</div>
        <p class="muted" style="margin:0 0 10px">12 questions answered · transcript kept with the application</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-action="toast:Accepting connects the canonical relationship (server-confirmed; simulated)">Connect</button><button class="btn" data-action="toast:Q drafts a reply; you approve before it is sent (simulated)">Reply</button><button class="btn" data-action="toast:Pass is neutral and records a reason (simulated)">Pass</button></div>
      </div></section>
    </div>`;
  }

  /* ---------------- investor: meetings & activity, portfolio ---------------- */
  function invMeetings() {
    return `<section class="panel"><header><h2>Meetings</h2></header><div class="rows">
      <div class="row link" data-action="open:halden:meetings">${icon("cal")}<div class="grow"><div class="title">Halden Grid · partner meeting ${fict}</div><div class="meta">Thu 9 Oct, 52 min · Q notes and transcript ready</div></div><span class="label">Recorded</span></div>
      <div class="row link" data-action="open:corvid:meetings">${icon("cal")}<div class="grow"><div class="title">Corvid Health · first meeting ${fict}</div><div class="meta">Tue 7 Oct, 40 min · notes only</div></div><span class="label outline">Not recorded</span></div>
      <div class="row">${icon("cal")}<div class="grow"><div class="title">Kestrel Robotics · customer reference ${fict}</div><div class="meta">Thu 16 Oct, 11:00 · upcoming</div></div></div>
    </div></section>
    <div class="section-title">Activity</div>
    <section class="panel"><div class="rows">
      ${actRow("Halden Grid", "Financial model v3 shared", "10 Oct 08:14 · relationship-shared", "file")}
      ${actRow("Kestrel Robotics", "Diligence started", "10 Oct · Jonas Lind", "share")}
      ${actRow("Halden Grid", "Meeting held", "9 Oct", "cal")}
      ${actRow("Corvid Health", "Meeting held", "7 Oct", "cal")}
      ${actRow("Tessera Freight", "Connected", "3 Oct", "users")}
    </div></section>`;
  }
  function invPortfolio() {
    const p = D.companies.filter((c) => c.state === "INVESTED");
    return `<section class="panel"><header><h2>Portfolio</h2><span class="faint">${p.length}</span></header><div class="rows">${p.map((c) => `<div class="row link" data-action="open:${c.id}:overview"><span class="avatar sm">${c.initials}</span><div class="grow"><div class="title">${c.name}${fict}</div><div class="meta">${c.outcome.detail} · ${c.next}</div></div>${stateLabel(c.state)}</div>`).join("")}</div></section>
    <p class="faint" style="font-size:12px">Commitments are recorded money. Amounts mentioned in meetings are signals, never commitments.</p>`;
  }

  /* ---------------- reports (both roles) ---------------- */
  function reports() {
    const inv = S.role === "investor";
    return `<div class="grid two"><section class="panel" ${q("section.reports")}><header><h2>Results report</h2></header><div class="body">
      <p class="muted" style="margin-top:0">The same report as today's Results page, for a period. Every number is a recorded count; unknowns are written in words.</p>
      <div class="toolbar">${["7 days", "30 days", "This quarter", "Custom"].map((p, i) => `<button class="chip" aria-pressed="${i === 1}">${p}</button>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-action="toast:Downloads /results/report?format=pdf&range=30d (existing route; simulated here)">${icon("down")}PDF report</button><button class="btn" data-action="toast:Downloads /results/report?format=csv&range=30d (existing route; simulated here)">${icon("down")}CSV</button></div>
      <p class="faint" style="font-size:12px;margin-bottom:0">Existing routes kept: <span class="mono">/results/report?format=pdf|csv</span></p>
    </div></section>
    <section class="panel"><header><h2>Export a relationship</h2><span class="label warn">Needs implementation</span></header><div class="body">
      <p class="muted" style="margin-top:0">${inv ? "One company's record as a PDF: identity, state history, evidence with sources, meetings and decisions. Your private notes are included only if you choose." : "One investor relationship as a PDF: shared documents, meetings, requests and commitments. Investor-private material is never in a founder export."}</p>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" ${inv ? "" : "disabled"} /> ${inv ? "Include organisation-private notes" : "Investor notes are not available to you"}</label>
      <button class="btn" data-action="toast:Export is prepared as a job and offered as a download (simulated)">Prepare export</button>
    </div></section></div>`;
  }

  /* ---------------- investor: record ---------------- */
  function recordHeader(c) {
    return `<div class="crumb"><button data-action="back" ${q("button.record-back")}>${S.role === "investor" ? "Investment Hub" : "Fundraising Hub"}</button><span>/</span><span>${S.role === "investor" ? "Pipeline" : "Investors"}</span><span>/</span><span>${c.name}</span></div>
    <div class="record-head${S.recordTab === "overview" ? "" : " compact"}"><span class="avatar">${c.initials}</span><div><h1>${c.name}${fict}</h1><div class="muted">${S.role === "investor" ? `${c.sector} · ${c.geo} · ${c.stage} · raising ${c.raise}` : `${c.type} · ${c.geo} · cheque ${c.cheque}`}</div>
      <div class="facts"><div><span class="k">Stage</span>${stateLabel(c.state)}</div><div><span class="k">${S.role === "investor" ? "Owner" : "Your contact"}</span>${S.role === "investor" ? c.owner : "Amara Okafor"}</div><div><span class="k">Last activity</span><span class="num">${c.last}</span></div><div><span class="k">History</span>${S.role === "investor" ? c.events : 11} events</div></div></div>
      <div class="next-action" ${q("section.next-action")}><div class="k">Next action</div><div style="font-weight:600;margin:2px 0 8px">${c.next}</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" data-action="${S.role === "investor" ? "toast:Opens the typed action Start diligence / Pause / Pass, server-confirmed (simulated)" : "go-rtab:requests"}">${S.role === "investor" ? "Decide" : "Open request"}</button><button class="btn sm" data-action="q-open">Ask Q</button></div></div>
    </div>`;
  }
  function axes(c) {
    // Progressive disclosure: the reasons show on Overview; other tabs keep the five words only.
    const full = S.recordTab === "overview";
    const a = (k, o) =>
      `<div class="axis"><div class="k">${k}</div><div class="v">${o.word}</div>${full && o.detail ? `<div class="w">${o.detail}</div>` : ""}</div>`;
    if (!full)
      return `<div class="axes compact" aria-label="Separate assessments">${a("Mandate fit", c.fit)}${a("Business evidence", c.quality)}${a("Interest", c.interest)}${a("Readiness", c.readiness)}${a("Outcome", c.outcome)}</div>`;
    return `<div class="axes" aria-label="Separate assessments">${a("Mandate fit", c.fit)}${a("Business evidence", c.quality)}${a("Interest", c.interest)}${a("Readiness", c.readiness)}${a("Outcome", c.outcome)}</div>
    <p class="faint" style="font-size:12px;margin:6px 2px 0">Five separate readings, never one score. Fit compares to your declared mandate; it is not a judgement of quality.</p>`;
  }
  function recordTabs(tabs) {
    return `<div class="tabs" role="tablist" aria-label="Record" ${q("list.record-tabs")}>${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${S.recordTab === k}" data-action="rtab:${k}" ${q("tab.record-" + k)}>${l}</button>`).join("")}</div>`;
  }
  function invRecord() {
    const c = company(S.recordId) || company("halden");
    const t = S.recordTab;
    let body;
    if (t === "overview") body = recOverview(c);
    else if (t === "evidence") body = recEvidence(c);
    else if (t === "gateq") body = recGateq(c);
    else if (t === "meetings") body = recMeeting();
    else if (t === "documents") body = recDocument();
    else if (t === "notes") body = recNotes();
    else if (t === "diligence") body = recDiligence();
    else if (t === "work") body = recWork();
    else body = recHistory(c);
    return `${recordHeader(c)}${axes(c)}${recordTabs(INV_TABS)}${body}`;
  }
  function recOverview() {
    return `${briefing(
      [
        `<strong>Where you are:</strong> in diligence since 26 Sep. The founder asked for your next step by 23 Oct.`,
        `<strong>What changed:</strong> model v3 (10 Oct) raises gross margin to 71%; deck v2 said 64%. Both stay on record until reconciled.`,
        `<strong>What they need:</strong> a decision on diligence. <strong>What you asked for:</strong> revised model (received) and two references (not yet).`,
      ],
      "From 14 events, 3 documents and 1 meeting on this relationship.",
    )}
    <div class="grid halves">
      <section class="panel"><header><h2>Open items</h2></header><div class="rows">
        <div class="row">${icon("clock")}<div class="grow"><div class="title">Two customer references</div><div class="meta">Requested 9 Oct · due Mon 13 Oct · overdue 1 day</div></div><span class="label warn">Open</span></div>
        <div class="row">${icon("check")}<div class="grow"><div class="title">Revised financial model</div><div class="meta">Received 10 Oct (v3)</div></div><span class="label pos">Received</span></div>
        <div class="row link" data-action="work:w2">${icon("msg")}<div class="grow"><div class="title">Follow-up message drafted by Q</div><div class="meta">Waiting for your approval</div></div><span class="label warn">Needs you</span></div>
      </div></section>
      <section class="panel"><header><h2>Latest meeting</h2><span class="right"><button class="btn sm ghost" data-action="rtab:meetings">Open</button></span></header><div class="body">
        <div class="muted" style="margin-bottom:8px">${D.meeting.when}</div>
        <ul class="summary-list" style="padding:0 0 0 18px">${D.meeting.summary
          .slice(0, 3)
          .map(
            (s) =>
              `<li>${s.text} <button class="linkish mono" data-action="jump:${s.at}">${s.at}</button></li>`,
          )
          .join("")}</ul>
      </div></section>
    </div>`;
  }
  function claimTags(cl) {
    const tcls =
      cl.truth === "VERIFIED"
        ? "pos"
        : cl.truth === "Q_INFERENCE"
          ? "accent"
          : cl.truth === "UNKNOWN"
            ? "outline"
            : "";
    const lcls = cl.life === "CONTRADICTORY" ? "warn" : "outline";
    return `<span class="label ${tcls}">${D.truthWords[cl.truth]}</span><span class="label outline">${D.evidenceWords[cl.evidence]}</span><span class="label ${lcls}">${D.lifeWords[cl.life]}</span>`;
  }
  function recEvidence() {
    return `<div class="grid two"><section class="panel" ${q("section.claims")}><header><h2>Material claims</h2><span class="faint">${D.claims.length}</span><span class="right faint" style="font-size:12px">Truth · evidence · lifecycle, separately</span></header><div class="rows" ${q("list.claims")}>
      ${D.claims.map((cl, i) => `<div class="claim${cl.contradiction ? " contradiction" : ""}" ${q("item.claim-" + (i + 1))}><div><div class="what">${cl.what}</div><div class="tags">${claimTags(cl)}</div><div class="src" style="margin-top:6px">${cl.src}</div></div><div>${cl.page ? `<button class="btn sm" data-action="page:${cl.page}" ${q("button.claim-" + (i + 1) + "-source")}>Open page ${cl.page}</button>` : cl.src.includes("14:32") ? `<button class="btn sm" data-action="jump:14:32">Jump to 14:32</button>` : cl.src.includes("03:41") ? `<button class="btn sm" data-action="rtab:gateq">Open transcript</button>` : ""}</div></div>`).join("")}
    </div></section>
    <div class="grid" style="align-content:start">
      <section class="panel"><header><h2>Q's reading</h2><span class="right label accent">Q inference</span></header><div class="body">
        <p style="margin-top:0">Revenue and pilots are document-supported. The margin difference is the material open question: the model's cost lines (p. 7) support 71% from July onward, and the deck predates the change.</p>
        <p class="muted">What would settle it: monthly hosting invoices for Q2–Q3. Not yet requested.</p>
        <button class="btn sm" data-action="compare" ${q("button.compare-kestrel")}>Compare with Kestrel Robotics</button>
      </div></section>
      <section class="panel"><header><h2>What Q cannot see</h2></header><div class="body muted" style="font-size:13px">Founder-private documents and Q memory the founder has not shared do not inform this view, its ranking or its wording.</div></section>
    </div></div>
    ${S.compare ? compareTable() : ""}`;
  }
  function compareTable() {
    const row = (k, a, as, b, bs) =>
      `<tr><td class="muted">${k}</td><td>${a}<span class="src">${as}</span></td><td>${b}<span class="src">${bs}</span></td></tr>`;
    return `<section class="panel compare" style="margin-top:20px" ${q("section.comparison")}><header><h2>Comparison · Halden Grid and Kestrel Robotics</h2><span class="label accent">Prepared by Q · source-backed</span><span class="right"><button class="btn sm ghost" data-action="compare-off">Close</button></span></header>
    <div class="table-wrap" style="border:0;border-radius:0"><table style="min-width:620px"><thead><tr><th>Measure</th><th>Halden Grid ${fict}</th><th>Kestrel Robotics ${fict}</th></tr></thead><tbody>
      ${row("Gross margin", "71% <span class='label warn'>Contradictory</span>", "Model v3 p. 7 · deck v2 slide 9 says 64%", "58%", "Management accounts Q3 p. 2 · document-supported")}
      ${row("Paying pilots", "3 (2 signed)", "Pilot letters · meeting 9 Oct 14:32", "5 signed", "Contracts folder · multi-source")}
      ${row("Runway", "about 14 months <span class='label accent'>Q inference</span>", "Derived from model v3 p. 9", "Unknown", "Not stated in anything you can see")}
      ${row("Mandate fit", "Fits", "Your declared mandate", "Fits", "Your declared mandate")}
    </tbody></table></div>
    <p class="faint" style="font-size:12px;padding:0 16px 12px;margin:0">No winner is declared. Unknown stays unknown; a missing figure is not counted as zero.</p></section>`;
  }
  function recGateq() {
    return `<div class="grid two"><section class="panel"><header><h2>GateQ dossier</h2><span class="right label pos">Fits · 7 of 7 rules</span></header><div class="body">
      <p class="muted" style="margin-top:0">Applied 21 Sep through your gateway. The dossier is the application exactly as submitted; Q's notes are kept beside it, not inside it.</p>
      <div class="rows" style="border:1px solid var(--cq-border-subtle);border-radius:var(--cq-radius-md)">
        <div class="row"><div class="grow"><div class="title">Ask</div><div class="meta">EUR 2.5m priced seed · 18 months runway target</div></div></div>
        <div class="row"><div class="grow"><div class="title">Deck</div><div class="meta">v2 as submitted (immutable) · later versions shared separately</div></div><button class="btn sm" data-action="page:1">Open</button></div>
        <div class="row"><div class="grow"><div class="title">Rules</div><div class="meta">Stage, sector, geography, cheque, revenue evidence, full-time founders, no conflict</div></div></div>
      </div></div></section>
      <section class="panel"><header><h2>Interview transcript</h2><span class="right faint" style="font-size:12px">Q asked · founder answered</span></header><div class="rows">
        ${[
          ["00:20", "Q", "What does a customer pay for first?"],
          [
            "00:41",
            "Tomas Reyes",
            "Day-ahead load forecasting for regional grid operators.",
          ],
          [
            "03:41",
            "Tomas Reyes",
            "Net revenue retention is above 120% across our first cohort.",
          ],
          ["04:05", "Q", "Is that measured over a full year?"],
          ["04:22", "Tomas Reyes", "Over nine months, for two customers."],
        ]
          .map(
            ([t, w, x]) =>
              `<div class="line"><span class="ts">${t}</span><span class="who">${w}</span><span class="text">${x}</span></div>`,
          )
          .join("")}
      </div></section></div>`;
  }
  function recMeeting() {
    const m = D.meeting;
    return `<div class="grid two meet">
      <section class="panel"><header><h2>Q's notes</h2><span class="label accent">Prepared by Q</span></header><div class="body" style="padding-bottom:0">
        <div class="muted">${m.when}</div><div class="muted" style="font-size:13px;margin:4px 0 10px">${m.who}</div>
        <span class="label outline">${icon("check")}${m.recording}</span></div>
        <div class="section-title" style="padding:0 16px">Summary, each line linked to its passage</div>
        <ol class="summary-list" ${q("list.meeting-summary")}>${m.summary.map((s, i) => `<li>${s.text} <button class="linkish mono" data-action="jump:${s.at}" ${q("button.summary-" + (i + 1))}>${s.at}</button></li>`).join("")}</ol>
        <div class="section-title" style="padding:0 16px">Follow-ups</div>
        <div class="rows"><div class="row"><div class="grow"><div class="title">Send decision on diligence by 23 Oct</div><div class="meta">You · from 44:02</div></div></div><div class="row"><div class="grow"><div class="title">Revised model and two references</div><div class="meta">Founder · model received, references open</div></div></div></div>
      </section>
      <section class="panel" ${q("section.transcript")}><header><h2>Transcript</h2><span class="faint">${m.transcript.length} passages</span><span class="right"><label class="search" style="height:32px;min-width:160px">${icon("search")}<input placeholder="Find in transcript" /></label></span></header>
        <div class="transcript" id="transcript" ${q("list.transcript")}>${m.transcript.map(([t, w, x]) => `<div class="line${S.transcriptAt === t ? " hit" : ""}" id="ts-${t.replace(":", "")}" ${q("item.transcript-" + t.replace(":", ""))}><button class="ts" data-action="jump:${t}">${t}</button><span class="who">${w}</span><span class="text">${x}</span></div>`).join("")}</div>
        <p class="faint" style="font-size:12px;padding:8px 16px;margin:0">Timestamps are a proposed contract addition: today's meeting transcript has speaker and text only.</p>
      </section></div>`;
  }
  function recDocument() {
    const d = D.document;
    const pageBody = (n) => {
      if (n === 4)
        return `<h4>Revenue build</h4><p>Recurring revenue by customer, monthly. <mark>Annual recurring revenue at September 2026: EUR 1.2m.</mark></p><div class="bar" style="width:80%"></div><div class="bar" style="width:62%"></div><div class="bar" style="width:70%"></div>`;
      if (n === 7)
        return `<h4>Cost of revenue</h4><p>Hosting moved in-house in July; inference costs per forecast fell by about half.</p><div class="bar" style="width:76%"></div><div class="bar" style="width:40%"></div><p><mark>Gross margin, Q3 2026: 71%.</mark> Q2 2026: 63%.</p><div class="bar" style="width:66%"></div>`;
      if (n === 9)
        return `<h4>Cash and runway</h4><p>Cash at 30 Sep and monthly net burn. Runway is computed in the model.</p><div class="bar" style="width:72%"></div><div class="bar" style="width:52%"></div>`;
      return `<h4>${["Cover", "Summary", "Assumptions", "", "Pipeline", "Headcount", "", "Operating costs", "", "Scenarios", "Use of funds", "Appendix"][n - 1]}</h4><p>Fictional sheet content for the prototype.</p><div class="bar" style="width:${50 + ((n * 13) % 40)}%"></div><div class="bar" style="width:${40 + ((n * 7) % 50)}%"></div><div class="bar" style="width:${55 + ((n * 11) % 35)}%"></div>`;
    };
    return `<div class="doc-meta"><strong style="color:var(--cq-text-primary);font-size:14px">${d.title} ${d.version}</strong>${fict}<span>Immutable version · fingerprint <span class="mono">${d.sha}…</span></span><span>Shared by ${d.sharedBy} · ${d.sharedAt}</span><span class="scope-mark">${icon("share")} relationship_shared</span>
      <label style="margin-left:auto">Version <select ${q("menu.document-version")}>${d.versions.map((v, i) => `<option ${i === 2 ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <span class="num" ${q("section.document-page")}>Page <strong>${S.docPage}</strong> of ${d.pages}</span>
      <button class="btn sm" data-action="page-prev" ${q("button.document-previous")}>Previous</button><button class="btn sm" data-action="page-next" ${q("button.document-next")}>Next</button></div>
      <div class="doc"><div class="thumbs" ${q("list.document-pages")}>${Array.from({ length: d.pages }, (_, i) => `<button class="thumb" data-action="page:${i + 1}" aria-current="${S.docPage === i + 1}"><div class="mini"></div>Page ${i + 1}</button>`).join("")}</div>
      <div class="pages" id="pages">${Array.from({ length: d.pages }, (_, i) => `<article class="sheet" id="page-${i + 1}" aria-label="Page ${i + 1}">${pageBody(i + 1)}<div class="pno">${d.title} ${d.version} · p. ${i + 1}</div></article>`).join("")}</div></div>`;
  }
  function recNotes() {
    return `<div class="grid halves"><section class="panel"><header><h2>Messages with Halden Grid</h2><span class="right scope-mark">${icon("share")} relationship_shared</span></header><div class="rows">
      <div class="row"><span class="avatar sm">TR</span><div class="grow"><div class="title">Tomas Reyes · 10 Oct 08:16</div><div class="meta">Model v3 is in the data room. References by Monday.</div></div></div>
      <div class="row"><span class="avatar sm">AO</span><div class="grow"><div class="title">Amara Okafor · 9 Oct 15:02</div><div class="meta">Thank you for today. As discussed: revised model and two references.</div></div></div>
    </div></section>
    <section class="panel"><header><h2>Team notes</h2><span class="right scope-mark">${icon("lock")} organisation_private</span></header><div class="rows">
      <div class="row"><div class="grow"><div class="title">Jonas Lind · 9 Oct</div><div class="meta">Margin story is plausible if invoices back it. Third pilot is the swing factor.</div></div></div>
      <div class="row"><div class="grow"><div class="title">Task · Amara Okafor</div><div class="meta">IC memo draft by 20 Oct</div></div><span class="label outline">Open</span></div>
    </div><p class="faint" style="font-size:12px;padding:0 16px 12px;margin:0">Private to Northgate. Never shown to the founder, never used in anything the founder sees.</p></section></div>`;
  }
  function recDiligence() {
    return `<section class="panel"><header><h2>Diligence requests</h2><span class="faint">5</span></header><div class="rows">
      ${[
        ["Financial model, monthly", "Received v3 · 10 Oct", "pos", "Received"],
        ["Two customer references", "Due 13 Oct", "warn", "Overdue"],
        ["Pilot contracts", "Received · 2 of 3", "", "Partly"],
        [
          "Hosting invoices Q2–Q3",
          "Suggested by Q · not requested",
          "outline",
          "Draft",
        ],
        ["Cap table", "Requested 9 Oct", "", "Open"],
      ]
        .map(
          ([t, m, c, l]) =>
            `<div class="row"><div class="grow"><div class="title">${t}</div><div class="meta">${m}</div></div><span class="label ${c}">${l}</span></div>`,
        )
        .join("")}
    </div></section>`;
  }
  function recWork() {
    return `<section class="panel"><header><h2>Q Work on this relationship</h2></header><div class="rows">${D.work
      .slice(0, 2)
      .map(
        (w) =>
          `<div class="row link" data-action="work:${w.id}">${qMark(w.state === "RUNNING").replace('class="aperture', 'style="width:24px;height:24px" class="aperture')}<div class="grow"><div class="title">${w.title}</div><div class="meta">${workWord(w.state)}</div></div><button class="btn sm">Open</button></div>`,
      )
      .join("")}</div></section>`;
  }
  function recHistory() {
    const ev = [
      [
        "14",
        "10 Oct 08:14",
        "document_shared",
        "HUMAN",
        "Financial model v3 shared (relationship_shared)",
      ],
      ["13", "9 Oct 14:52", "meeting_held", "SYSTEM", "Meeting held · 52 min"],
      [
        "12",
        "26 Sep",
        "diligence_started",
        "HUMAN",
        "Diligence started by Amara Okafor",
      ],
      [
        "9",
        "25 Sep",
        "connection_accepted",
        "HUMAN",
        "Founder accepted connection",
      ],
      [
        "8",
        "24 Sep",
        "interest_expressed",
        "HUMAN",
        "Interest expressed by Amara Okafor",
      ],
      [
        "1",
        "21 Sep",
        "gateq_application",
        "CONNECTED_SYSTEM",
        "Applied through GateQ",
      ],
    ];
    return `<section class="panel"><header><h2>History</h2><span class="right faint" style="font-size:12px">Append-only events · state is derived from them</span></header><div class="table-wrap stack-mobile" style="border:0"><table><thead><tr><th>#</th><th>When</th><th>Event</th><th>Actor</th><th>What happened</th></tr></thead><tbody>${ev.map((e) => `<tr><td class="num hide-m">${e[0]}</td><td class="num">${e[1]}</td><td class="mono hide-m" style="font-size:12px">${e[2]}</td><td class="hide-m">${e[3]}</td><td>${e[4]}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  /* ---------------- Q Work job ---------------- */
  function workView() {
    const w = D.work.find((x) => x.id === S.workId) || D.work[0];
    const dotCls = { done: "done", run: "run", wait: "wait", todo: "" };
    const approval = w.id === "w2" ? approvalCard() : "";
    return `<div class="crumb"><button data-action="${S.returnTo ? "return" : "go:overview"}" ${q("button.work-back")}>${S.returnTo ? "Back to " + S.returnTo.label : "Hub"}</button><span>/</span><span>Work</span></div>
    <div class="page-head"><div><h1>${w.title}</h1><div class="sub">Started ${w.started} · ${workWord(w.state)}</div></div></div>
    <div class="grid two" style="margin-top:16px"><section class="panel" ${q("section.work-steps")}><header><h2>Steps</h2><span class="right faint" style="font-size:12px">Stages only; Q's internal reasoning is not shown</span></header><ol class="steps">${w.steps.map(([t, s, at]) => `<li><span class="dot ${dotCls[s]}"></span><span>${t}</span><span class="faint num" style="font-size:12px">${s === "run" ? "running" : at}</span></li>`).join("")}</ol></section>
    <section class="panel"><header><h2>What this job may do</h2></header><div class="body muted" style="font-size:13px">Read: documents shared with Northgate on this relationship, meeting notes, your mandate. Write: nothing without approval. Send: nothing without approval.</div></section></div>
    ${approval}`;
  }
  function approvalCard() {
    const st = S.approval;
    const status = {
      OPEN: ["warn", "Waiting for you"],
      SENDING: ["accent", "Sending… (acknowledged by server)"],
      SENT: ["pos", "Sent 14 Oct 10:21 · receipt rcpt_7Q2"],
      REJECTED: ["", "Rejected · nothing sent"],
    }[st];
    return `<section class="approval" style="margin-top:20px" ${q("section.approval")}><header style="display:flex;gap:10px;align-items:center;padding:14px 16px 10px"><h2 style="margin:0;font-size:15px">Approve message to Tomas Reyes (Halden Grid ${fict})</h2><span class="label ${status[0]}" ${q("section.approval-status")}>${status[1]}</span></header>
    <div class="payload">To: Tomas Reyes · Channel: Capital Q messages · Visibility: relationship_shared

Thank you for Thursday. We have model v3, thanks. Two items remain before we decide on diligence: the two customer references, and hosting invoices for Q2 and Q3 so we can tie out the margin change. We will tell you our next step by 23 October.

— Amara</div>
    <p class="faint" style="font-size:12px;margin:0 16px 12px">You approve exactly this text. Editing it creates a new draft that needs approval again. One idempotency key per send.</p>
    <div style="display:flex;gap:8px;padding:0 16px 16px;flex-wrap:wrap">${st === "OPEN" ? `<button class="btn primary" data-action="approve" ${q("button.approval-approve")}>Approve and send</button><button class="btn" data-action="toast:Editing creates a new draft that needs approval again (simulated)">Edit</button><button class="btn" data-action="reject">Reject</button>` : `<button class="btn" data-action="approval-reset">Reset prototype</button>`}</div></section>`;
  }

  /* ---------------- founder ---------------- */
  function fndOverview() {
    const r = D.round;
    return `${briefing(
      [
        "<strong>Two investors are waiting on you.</strong> Northgate asked for two customer references (due Monday, now overdue). Pell & Co expressed interest yesterday and has no answer yet.",
        "Your round: EUR 150,000 confirmed and EUR 400,000 stated (not yet committed) against a EUR 2.5m target.",
      ],
      "Read from your relationships and your round.",
    )}
    <div class="stages" style="--n:5">${["INTEREST_EXPRESSED", "CONNECTED", "MEETING_HELD", "IN_DILIGENCE", "INVESTED"].map((s) => `<button class="stage" data-action="fstage:${s}"><div class="n">${D.investors.filter((i) => i.state === s).length}</div><div class="l">${sw(s)}</div></button>`).join("")}</div>
    <div class="grid two" style="margin-top:20px">
      <section class="panel"><header><h2>Needs you</h2><span class="faint">3</span></header><div class="rows">
        <div class="row"><span class="avatar sm">NP</span><div class="grow"><div class="title">Send two customer references to Northgate</div><div class="meta">Asked 9 Oct · due 13 Oct</div></div><button class="btn sm" data-action="fopen:northgate:requests">Open</button></div>
        <div class="row"><span class="avatar sm">PC</span><div class="grow"><div class="title">Answer Pell & Co's interest</div><div class="meta">Expressed 12 Oct</div></div><button class="btn sm" data-action="fopen:pell:overview">Open</button></div>
        <div class="row"><span class="avatar sm">FA</span><div class="grow"><div class="title">Approve October investor update</div><div class="meta">Q drafted it from your September numbers</div></div><button class="btn sm" data-action="go:updates">Review</button></div>
      </div></section>
      <section class="panel"><header><h2>Your round</h2><span class="right"><button class="btn sm ghost" data-action="go:fundraising">Open</button></span></header><div class="body">${roundBar()}<div class="muted" style="font-size:13px;margin-top:10px">${r.instrument} · ${r.close}</div></div></section>
    </div>
    <section class="panel" style="margin-top:20px" ${q("section.founder-q")}><header><h2>Q's recommendation</h2><span class="label accent">Q inference · source-backed</span></header><div class="body">
      <p style="margin-top:0;max-width:72ch">Send Northgate the references before anything else. They are the only investor in diligence, they asked for a decision date (23 Oct), and the references are the one open item they named in the meeting.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px"><span class="label outline">Request · 9 Oct</span><span class="label outline">Meeting · 9 Oct · 47:50</span><span class="label outline">Message · 10 Oct</span></div>
      <p class="faint" style="font-size:12px">Based only on what Northgate shared with you. Their internal notes are never visible to you or to Q on your behalf.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-action="fopen:northgate:requests">Open the request</button><button class="btn" data-action="q-open">Ask Q why</button></div>
    </div></section>`;
  }
  function roundBar() {
    return `<div style="display:flex;justify-content:space-between;font-size:13px"><span>Confirmed <strong class="num">EUR 150,000</strong></span><span class="muted">Target <span class="num">EUR 2,500,000</span></span></div>
      <div style="height:10px;border-radius:5px;background:var(--cq-surface-strong);margin:8px 0;overflow:hidden;display:flex" role="img" aria-label="6% confirmed, 16% stated"><span style="width:6%;background:var(--cq-positive)"></span><span style="width:16%;background:repeating-linear-gradient(45deg,var(--cq-accent-soft) 0 4px,var(--cq-border) 4px 8px)"></span></div>
      <div style="display:flex;gap:14px;font-size:12px" class="muted"><span>Solid: confirmed</span><span>Hatched: stated, not committed (EUR 400,000)</span></div>`;
  }
  function fndInvestors() {
    let list = D.investors;
    if (S.stage) list = list.filter((c) => c.state === S.stage);
    if (S.search)
      list = list.filter((c) =>
        c.name.toLowerCase().includes(S.search.toLowerCase()),
      );
    if (S.saved === "active")
      list = list.filter((c) => !["PASSED", "INVESTED"].includes(c.state));
    if (S.saved === "mine")
      list = list.filter((c) =>
        ["ANSWER_INTEREST", "FOLLOW_UP"].includes(c.nextStep),
      );
    if (S.saved === "diligence")
      list = list.filter((c) => c.state === "IN_DILIGENCE");
    if (S.saved === "gateq") list = list.filter((c) => c.commitment);
    const body =
      S.view === "table"
        ? `<div class="table-wrap stack-mobile"><table ${q("list.investors")}><thead><tr><th>Investor</th><th>Stage</th><th>Mandate fit</th><th>Cheque</th><th>Next action</th><th>Last activity</th></tr></thead><tbody>${list.map((c, i) => `<tr data-action="fopen:${c.id}:overview" ${q("item.investor-" + (i + 1))}><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar sm">${c.initials}</span><div><div class="name">${c.name}</div><div class="sub">${c.type} · ${c.geo}</div></div></div></td><td>${stateLabel(c.state)}</td><td class="hide-m">${c.fit}</td><td class="hide-m">${c.cheque}</td><td class="hide-m">${c.next}</td><td class="num hide-m">${c.last}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="board">${[
            "INTEREST_EXPRESSED",
            "CONNECTED",
            "MEETING_HELD",
            "IN_DILIGENCE",
            "INVESTED",
          ]
            .map((s) => {
              const it = list.filter((c) => c.state === s);
              return `<div class="col"><h3>${sw(s)} <span class="faint">${it.length}</span></h3>${it.map((c) => `<div class="tile" data-action="fopen:${c.id}:overview"><div class="name">${c.name}</div><div class="meta">${c.type}</div><div class="next">Next: ${c.next}</div></div>`).join("")}</div>`;
            })
            .join("")}</div>`;
    return `${pipelineToolbar("fnd")}${body}<p class="faint" style="font-size:12px;margin-top:10px">The same canonical relationships the investors see, from your side. Investors are never created here.</p>`;
  }
  function fndRecord() {
    const c = investor(S.recordId) || investor("northgate");
    const t = S.recordTab;
    let body;
    const privacy = `<p class="faint" style="font-size:12px;display:flex;gap:6px;align-items:center;margin:0 0 14px">${icon("lock").replace("<svg", '<svg style="width:13px;height:13px"')} You see what ${c.name} shared with you. Their internal notes, deliberations and scores are private to them and never shown here.</p>`;
    if (t === "overview")
      body = `${privacy}<div class="grid halves"><section class="panel"><header><h2>Where you are</h2></header><div class="body"><p style="margin-top:0">${sw(c.state)} since 26 Sep. They said they will tell you their next step by <strong>23 Oct</strong> (meeting 9 Oct, 44:02).</p><p class="muted">Fit: ${c.fit}. This compares your round to their declared mandate; it says nothing about their interest.</p></div></section>
      <section class="panel"><header><h2>Open requests from them</h2></header><div class="rows"><div class="row link" data-action="go-rtab:requests"><div class="grow"><div class="title">Two customer references</div><div class="meta">Due 13 Oct · overdue</div></div><span class="label warn">Open</span></div><div class="row"><div class="grow"><div class="title">Cap table</div><div class="meta">Asked 9 Oct</div></div><span class="label">Open</span></div></div></section></div>`;
    else if (t === "meetings")
      body = `${privacy}${recMeeting().replace("Q's notes", "Q's notes for you")}`;
    else if (t === "requests")
      body = `${privacy}<section class="panel" ${q("section.requests")}><header><h2>Requests from ${c.name}</h2></header><div class="rows">
      <div class="row"><div class="grow"><div class="title">Two customer references</div><div class="meta">Asked 9 Oct in the meeting (47:50) · due 13 Oct</div></div><button class="btn sm primary" data-action="toast:Choosing references opens a share with relationship_shared scope; you confirm before it is sent (simulated)">Respond</button></div>
      <div class="row"><div class="grow"><div class="title">Revised financial model</div><div class="meta">Shared v3 on 10 Oct</div></div><span class="label pos">Done</span></div>
      <div class="row"><div class="grow"><div class="title">Cap table</div><div class="meta">Asked 9 Oct</div></div><button class="btn sm">Respond</button></div></div></section>`;
    else if (t === "documents")
      body = `${privacy}<section class="panel"><header><h2>Shared with ${c.name}</h2></header><div class="rows">${[
        ["Financial model v3", "10 Oct · they opened it 10 Oct"],
        ["Deck v2", "24 Sep"],
        ["Pilot letters (2)", "26 Sep"],
      ]
        .map(
          ([t2, m]) =>
            `<div class="row">${icon("file")}<div class="grow"><div class="title">${t2}</div><div class="meta">${m}</div></div><span class="scope-mark">${icon("share")} relationship_shared</span></div>`,
        )
        .join("")}</div></section>`;
    else if (t === "messages")
      body = `${privacy}${recNotes().split('<section class="panel"><header><h2>Team notes')[0]}</div>`;
    else if (t === "intel")
      body = `${privacy}<section class="panel"><header><h2>Q intelligence on ${c.name}</h2><span class="label accent">From public and shared sources</span></header><div class="body"><p style="margin-top:0">Northgate has made 4 seed investments in energy software in the last two years (public announcements). Their declared cheque range is EUR 500k–1.5m.</p><p class="muted">Q does not infer their interest from their activity. "They opened the model" is a recorded event, not a signal of intent.</p></div></section>`;
    else
      body = `${privacy}<section class="panel"><header><h2>History</h2></header><div class="rows">${[
        ["10 Oct", "You shared Financial model v3"],
        ["9 Oct", "Meeting held"],
        ["26 Sep", "Diligence started"],
        ["25 Sep", "You accepted their connection"],
        ["24 Sep", "They expressed interest"],
      ]
        .map(
          ([a, b]) =>
            `<div class="row"><span class="num faint" style="width:60px">${a}</span><div class="grow">${b}</div></div>`,
        )
        .join("")}</div></section>`;
    return `${recordHeader(c)}<div style="height:16px"></div>${recordTabs(FND_TABS)}${body}`;
  }
  function fndFundraising() {
    const withC = D.investors.filter((i) => i.commitment);
    return `<div class="grid two"><section class="panel"><header><h2>Round progress</h2></header><div class="body">${roundBar()}</div></section><section class="panel"><header><h2>Round</h2></header><div class="body muted">${D.round.instrument} · ${D.round.target} · ${D.round.close}</div></section></div>
    <section class="panel" style="margin-top:20px"><header><h2>Commitments</h2></header><div class="rows">${withC.map((c) => `<div class="row"><span class="avatar sm">${c.initials}</span><div class="grow"><div class="title">${c.name}${fict}</div><div class="meta">${c.commitment.status === "CONFIRMED" ? "Confirmed by both sides" : "Stated by the investor; not a commitment until confirmed"}</div></div><span class="num" style="font-weight:600">${c.commitment.amount}</span><span class="label ${c.commitment.status === "CONFIRMED" ? "pos" : "outline"}">${c.commitment.status === "CONFIRMED" ? "Confirmed" : "Stated"}</span></div>`).join("")}</div></section>
    <p class="faint" style="font-size:12px">Money mentioned in meetings is never counted here. Built on the existing capital rounds and commitments.</p>`;
  }
  function fndRequests() {
    return `<div class="grid halves"><section class="panel"><header><h2>Requests</h2></header><div class="rows">
      <div class="row link" data-action="fopen:northgate:requests"><span class="avatar sm">NP</span><div class="grow"><div class="title">Two customer references</div><div class="meta">Northgate · due 13 Oct</div></div><span class="label warn">Overdue</span></div>
      <div class="row link" data-action="fopen:northgate:requests"><span class="avatar sm">NP</span><div class="grow"><div class="title">Cap table</div><div class="meta">Northgate · asked 9 Oct</div></div><span class="label">Open</span></div>
      <div class="row"><span class="avatar sm">AV</span><div class="grow"><div class="title">Product demo recording</div><div class="meta">Alder · asked 6 Oct</div></div><span class="label">Open</span></div></div></section>
      <section class="panel"><header><h2>Meetings</h2></header><div class="rows">
      <div class="row link" data-action="fopen:northgate:meetings">${icon("cal")}<div class="grow"><div class="title">Northgate · partner meeting</div><div class="meta">9 Oct · notes and transcript</div></div></div>
      <div class="row">${icon("cal")}<div class="grow"><div class="title">Meridian Seed · first meeting</div><div class="meta">Not scheduled · Q can propose times</div></div><button class="btn sm">Propose times</button></div></div></section></div>
      <section class="panel" style="margin-top:20px"><header><h2>Tasks</h2></header><div class="rows"><div class="row"><input type="checkbox" /><div class="grow">Ask two pilot customers to act as references</div><span class="faint">You</span></div><div class="row"><input type="checkbox" /><div class="grow">Export cap table from the registry</div><span class="faint">Ilse</span></div></div></section>`;
  }
  function fndUpdates() {
    return `<section class="approval" ${q("section.update-approval")}><header style="display:flex;gap:10px;align-items:center;padding:14px 16px 10px"><h2 style="margin:0;font-size:15px">October investor update</h2><span class="label warn">Draft · needs your approval</span></header>
    <div class="payload">To: Foxglove Angels (invested) · Visibility: specifically_shared

Highlights: ARR EUR 1.2m at September. Gross margin 71% in Q3 after moving hosting in-house. Third pilot signing this month.
Asks: introductions to two Nordic grid operators.</div>
    <p class="faint" style="font-size:12px;margin:0 16px 12px">Every figure links to your own documents (model v3 p. 4, p. 7). Q prepared it; you send it.</p>
    <div style="display:flex;gap:8px;padding:0 16px 16px;flex-wrap:wrap"><button class="btn primary" data-action="toast:Approval binds to this exact text; sending is server-confirmed (simulated)">Approve and send</button><button class="btn">Edit</button><button class="btn">Choose recipients</button></div></section>
    <div class="section-title">Sent</div><section class="panel"><div class="rows"><div class="row">${icon("msg")}<div class="grow"><div class="title">September update</div><div class="meta">Sent 2 Oct to Foxglove Angels</div></div></div></div></section>`;
  }

  /* ---------------- Q panel ---------------- */
  function qPanel() {
    const about =
      S.area === "record"
        ? S.role === "investor"
          ? company(S.recordId)?.name
          : investor(S.recordId)?.name
        : S.role === "investor"
          ? "Investment Hub"
          : "Fundraising Hub";
    return `<button class="q-dock" data-action="q-toggle" aria-expanded="${S.qOpen}" ${q("button.q-dock")}>${qMark(S.qWorking)}<span class="state">${S.qWorking ? "Q is working" : "Q"}<span class="faint">${S.qWorking ? "on your request" : "About: " + about}</span></span></button>
    <section class="q-panel" ${S.qOpen ? "" : "hidden"} aria-label="Q">
      <header>${qMark(S.qWorking)}<div><div class="t">Q</div><div class="about">About: ${about}</div></div><button class="btn sm ghost" style="margin-left:auto" data-action="q-toggle">Close</button></header>
      <div class="q-body" id="q-body">
        ${S.qSay ? `<div class="q-say">${S.qSay}</div>` : `<div class="q-say muted">Ask about this ${S.area === "record" ? "relationship" : "hub"}, or ask Q to move around for you.</div>`}
        ${S.qLog.length ? `<ul class="acts" aria-label="What Q did on the page">${S.qLog.map((a) => `<li class="act"><span>${a.label}</span><span class="st ${a.status}">${a.status}</span><span class="id">${a.act} → ${a.target}${a.note ? " · " + a.note : ""}</span></li>`).join("")}</ul>` : ""}
        <div class="suggest">${(S.role === "investor" ? ["Brief me on Halden Grid", "Show the margin evidence", "Compare with Kestrel", "Open the term sheet"] : ["What should I do next?", "Show Northgate's requests"]).map((s) => `<button data-action="qcmd:${s}">${s}</button>`).join("")}</div>
        <div class="sim-note">Prototype: Q's answers and page actions are scripted. Each act shows requested → acknowledged → completed or failed, from the page's own read-back.</div>
      </div>
      <form class="q-cmd" data-form="q"><input id="q-input" placeholder="Ask Q or tell Q where to go" autocomplete="off" ${q("input.q-command")} /><button class="btn primary" type="submit">Ask</button></form>
    </section>`;
  }

  /* ---------------- render ---------------- */
  function render() {
    const inv = S.role === "investor";
    let content;
    if (S.area === "record") content = inv ? invRecord() : fndRecord();
    else if (S.area === "work") content = workView();
    else {
      const map = inv
        ? {
            overview: invOverview,
            pipeline: invPipeline,
            gateq: invGateq,
            meetings: invMeetings,
            portfolio: invPortfolio,
            reports,
          }
        : {
            overview: fndOverview,
            investors: fndInvestors,
            fundraising: fndFundraising,
            requests: fndRequests,
            updates: fndUpdates,
            reports,
          };
      content = `${hubHead()}${areaTabs()}${(map[S.area] || map.overview)()}`;
    }
    const focusId = document.activeElement && document.activeElement.id;
    // Keep inner scroll positions across re-renders; animate only when the target changes.
    keep.pages = $("#pages")?.scrollTop ?? null;
    keep.transcript = $("#transcript")?.scrollTop ?? null;
    $("#app").innerHTML =
      `<div class="shell">${sidebar()}<main class="main" id="main"><div class="page">${content}</div></main></div>${bottomNav()}${qPanel()}${S.drawer ? drawer() : ""}`;
    $("#role-seg").innerHTML = ["investor", "founder"]
      .map(
        (r) =>
          `<button data-action="role:${r}" aria-pressed="${S.role === r}">${r === "investor" ? "Investor view" : "Founder view"}</button>`,
      )
      .join("");
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (el.setSelectionRange)
          el.setSelectionRange(el.value.length, el.value.length);
      }
    }
    toHash();
    afterRender();
  }
  const keep = { pages: null, transcript: null, page: null, ts: null };
  function glide(box, prev, top, changed) {
    if (prev !== null) box.scrollTop = prev;
    if (changed || prev === null)
      box.scrollTo({
        top,
        behavior: changed && prev !== null ? "smooth" : "auto",
      });
  }
  function afterRender() {
    if (S.area === "record" && S.recordTab === "documents") {
      const p = $("#page-" + S.docPage),
        box = $("#pages");
      if (p && box) {
        glide(box, keep.pages, p.offsetTop - 12, keep.page !== S.docPage);
        keep.page = S.docPage;
      }
      const th = $('.thumb[aria-current="true"]'),
        tb = $(".thumbs");
      if (th && tb) {
        if (getComputedStyle(tb).gridAutoFlow.startsWith("column"))
          tb.scrollLeft = th.offsetLeft - 8;
        else tb.scrollTop = th.offsetTop - 8;
      }
    }
    if (S.transcriptAt) {
      const l = $("#ts-" + S.transcriptAt.replace(":", "")),
        box = $("#transcript");
      if (l && box) {
        glide(
          box,
          keep.transcript,
          l.offsetTop - 60,
          keep.ts !== S.transcriptAt,
        );
        keep.ts = S.transcriptAt;
      }
    }
    const qb = $("#q-body");
    if (qb) qb.scrollTop = qb.scrollHeight;
  }
  function drawer() {
    return `<div class="drawer-scrim" data-action="drawer-close"></div><aside class="drawer" role="dialog" aria-label="Evidence"><header><h2>Evidence · gross margin</h2><button class="btn sm ghost" style="margin-left:auto" data-action="drawer-close">Close</button></header><div class="content">
      <p>Two sources disagree. Both are kept until the founder or a document reconciles them.</p>
      <div class="rows" style="border:1px solid var(--cq-border-subtle);border-radius:var(--cq-radius-md)"><div class="row"><div class="grow"><div class="title">71% · Financial model v3, p. 7</div><div class="meta">Document-supported · current · 10 Oct</div></div><button class="btn sm" data-action="page:7">Open page</button></div><div class="row"><div class="grow"><div class="title">64% · Deck v2, slide 9</div><div class="meta">Self-reported · historical · 24 Sep</div></div></div><div class="row"><div class="grow"><div class="title">Founder explanation · meeting 22:41</div><div class="meta">Hosting moved in-house in Q3</div></div><button class="btn sm" data-action="jump:22:41">Jump</button></div></div></div></aside>`;
  }

  /* ---------------- theme ---------------- */
  function themeChoice() {
    try {
      return localStorage.getItem("cq.theme") || "device";
    } catch {
      return "device";
    }
  }
  function applyTheme(t) {
    try {
      localStorage.setItem("cq.theme", t);
    } catch {
      /* storage may be blocked; the choice still applies now */
    }
    if (t === "device") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  /* ---------------- actions ---------------- */
  function toast(msg) {
    $$(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function go(area) {
    S.area = area;
    S.recordId = null;
    S.stage =
      S.stage && (area === "pipeline" || area === "investors") ? S.stage : null;
    S.transcriptAt = null;
    S.compare = false;
    render();
    window.scrollTo(0, 0);
  }
  function openRecord(id, tab) {
    S.area = "record";
    S.recordId = id;
    S.recordTab = tab || "overview";
    S.transcriptAt = null;
    S.compare = false;
    render();
    window.scrollTo(0, 0);
  }

  function handle(action) {
    const [k, ...rest] = action.split(":");
    const v = rest.join(":");
    switch (k) {
      case "noop":
        toast("Outside the Hub prototype");
        break;
      case "go":
        go(v);
        break;
      case "role":
        S.role = v;
        S.area = "overview";
        S.stage = null;
        S.search = "";
        S.saved = "active";
        S.qLog = [];
        S.qSay = null;
        render();
        break;
      case "theme":
        applyTheme(v);
        render();
        break;
      case "stage":
        S.stage = S.stage === v ? null : v;
        if (S.area !== "pipeline") S.area = "pipeline";
        render();
        break;
      case "fstage":
        S.stage = v;
        S.area = "investors";
        render();
        break;
      case "clear":
        S.stage = null;
        S.search = "";
        render();
        break;
      case "view":
        S.view = v;
        render();
        break;
      case "saved":
        S.saved = v;
        render();
        break;
      case "open": {
        const [id, tab] = v.split(":");
        openRecord(id, tab);
        break;
      }
      case "fopen": {
        const [id, tab] = v.split(":");
        openRecord(id, tab);
        break;
      }
      case "rtab":
        S.recordTab = v;
        if (v !== "meetings") S.transcriptAt = null;
        render();
        break;
      case "go-rtab":
        S.recordTab = v;
        render();
        break;
      case "back":
        go(S.role === "investor" ? "pipeline" : "investors");
        break;
      case "jump":
        S.recordTab = "meetings";
        S.transcriptAt = v;
        render();
        break;
      case "page":
        S.area = "record";
        S.recordId = S.recordId || "halden";
        S.recordTab = "documents";
        S.docPage = Number(v);
        S.drawer = null;
        render();
        break;
      case "page-next":
        S.docPage = Math.min(D.document.pages, S.docPage + 1);
        render();
        break;
      case "page-prev":
        S.docPage = Math.max(1, S.docPage - 1);
        render();
        break;
      case "gsel":
        S.gateqSel = v;
        render();
        break;
      case "work":
        if (S.area === "record")
          S.returnTo = {
            label: company(S.recordId)?.name || "record",
            area: "record",
            recordId: S.recordId,
            recordTab: S.recordTab,
          };
        S.area = "work";
        S.workId = v;
        render();
        window.scrollTo(0, 0);
        break;
      case "return": {
        const r = S.returnTo;
        S.returnTo = null;
        if (r) {
          S.area = r.area;
          S.recordId = r.recordId;
          S.recordTab = r.recordTab;
          render();
        } else go("overview");
        break;
      }
      case "compare":
        S.compare = true;
        render();
        $('[data-q="section.comparison"]')?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        break;
      case "compare-off":
        S.compare = false;
        render();
        break;
      case "approve":
        S.approval = "SENDING";
        render();
        setTimeout(() => {
          S.approval = "SENT";
          render();
        }, 1400);
        break;
      case "reject":
        S.approval = "REJECTED";
        render();
        break;
      case "approval-reset":
        S.approval = "OPEN";
        render();
        break;
      case "toast":
        toast(v);
        break;
      case "q-toggle":
        S.qOpen = !S.qOpen;
        render();
        if (S.qOpen) $("#q-input")?.focus();
        break;
      case "q-open":
        S.qOpen = true;
        render();
        $("#q-input")?.focus();
        break;
      case "q-investigate":
        S.qOpen = true;
        runCommand("Investigate further");
        break;
      case "qcmd":
        S.qOpen = true;
        runCommand(v);
        break;
      case "drawer-close":
        S.drawer = null;
        render();
        break;
      default:
        break;
    }
  }

  /* ---------------- Q control (simulated) ---------------- */
  // A typed act on a control by semantic id. The receipt is derived from a
  // read-back of the page, not assumed.
  async function act(label, a, target, perform, verify, note) {
    const entry = { label, act: a, target, status: "requested", note };
    S.qLog.push(entry);
    render();
    await sleep(450);
    const el = $(`[data-q="${target}"]`);
    if (!el) {
      entry.status = "failed";
      entry.note = "TARGET_MISSING: not on this page";
      render();
      return false;
    }
    entry.status = "acknowledged";
    render();
    mark(target);
    await sleep(700);
    try {
      await perform();
    } catch {
      entry.status = "failed";
      render();
      return false;
    }
    await sleep(350);
    const ok = verify ? verify() : true;
    entry.status = ok ? "completed" : "failed";
    if (!ok) entry.note = "read-back did not match";
    render();
    mark(target);
    await sleep(500);
    unmark();
    return ok;
  }
  function mark(target) {
    unmark();
    const el = $(`[data-q="${target}"]`);
    if (!el) return;
    el.classList.add("q-target");
    const r = el.getBoundingClientRect();
    const tag = document.createElement("div");
    tag.className = "q-target-tag";
    tag.textContent = "Q · " + target;
    tag.style.left = Math.max(8, r.left + window.scrollX) + "px";
    tag.style.top = Math.max(40, r.top + window.scrollY - 22) + "px";
    document.body.appendChild(tag);
  }
  function unmark() {
    $$(".q-target").forEach((e) => e.classList.remove("q-target"));
    $$(".q-target-tag").forEach((e) => e.remove());
  }
  const selected = (id) => () =>
    $(`[data-q="${id}"]`)?.getAttribute("aria-selected") === "true";
  const pressed = (id) => () =>
    $(`[data-q="${id}"]`)?.getAttribute("aria-pressed") === "true";
  const exists = (id) => () => !!$(`[data-q="${id}"]`);

  async function say(html) {
    S.qSay = html;
    render();
    await sleep(300);
  }
  let running = false;
  async function runCommand(text) {
    if (running) return;
    running = true;
    S.qOpen = true;
    S.qLog = [];
    S.qWorking = true;
    S.qSay = `<span class="muted">“${text}”</span>`;
    render();
    const t = text.toLowerCase();
    try {
      if (t.includes("brief me")) {
        await say(
          `<span class="muted">“${text}”</span><br><br><strong>Halden Grid</strong> ${fict}: in diligence since 26 Sep. Model v3 says 71% gross margin; deck v2 said 64%. Both are kept. They want your decision by 23 Oct. References are overdue by one day.<div class="src faint">Briefing: permission-filtered read of 14 events · no model reasoning shown · simulated</div>`,
        );
        await act(
          "Open Halden Grid",
          "NAVIGATE",
          "item.pipeline-1",
          async () => openRecord("halden", "overview"),
          exists("section.next-action"),
        ).catch(() => {});
      } else if (
        t.includes("margin") ||
        t.includes("evidence") ||
        t === "investigate further"
      ) {
        await tour(true);
      } else if (t.includes("compare")) {
        if (S.area !== "record" || S.recordTab !== "evidence") {
          await act(
            "Open Halden Grid",
            "OPEN_RECORD_PAGE",
            "button.q-dock",
            async () => openRecord("halden", "evidence"),
            exists("section.claims"),
          );
        }
        await act(
          "Compare with Kestrel Robotics",
          "ACTIVATE",
          "button.compare-kestrel",
          async () => {
            S.compare = true;
            render();
          },
          exists("section.comparison"),
        );
        $('[data-q="section.comparison"]')?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        await say(
          `Here is the comparison, every figure with its source. Halden's margin is contradictory, and Kestrel's runway is unknown. No winner is declared.<div class="src faint">From documents shared with Northgate only · simulated</div>`,
        );
      } else if (t.includes("term sheet")) {
        await say(
          `<span class="muted">“${text}”</span><br><br>Looking for a term sheet on this relationship…`,
        );
        await act(
          "Open the term sheet",
          "OPEN_RECORD_PAGE",
          "item.document-term-sheet",
          async () => {},
          () => false,
        );
        await say(
          `I couldn't open it: <strong>no term sheet has been shared with you</strong> on Halden Grid. I did not open anything else in its place.<div class="src faint">Receipt: failed (TARGET_MISSING) · nothing changed</div>`,
        );
      } else if (t.includes("next") || t.includes("requests")) {
        await act(
          "Open Northgate Partners",
          "OPEN_RECORD_PAGE",
          "button.q-dock",
          async () => openRecord("northgate", "requests"),
          exists("section.requests"),
        );
        await say(
          `Send Northgate the two references first. They are the only investor in diligence and named the references in the meeting (47:50).<div class="src faint">Sources: request 9 Oct · meeting 9 Oct · simulated</div>`,
        );
      } else {
        await say(
          `<span class="muted">“${text}”</span><br><br>In this prototype I can brief you, show the margin evidence, compare with Kestrel, or try to open a term sheet.`,
        );
      }
    } finally {
      S.qWorking = false;
      running = false;
      render();
    }
  }

  // Video 3: Q drives the workspace by semantic control ids, then returns.
  async function tour() {
    await say(
      `I'll find Halden Grid's margin evidence: the pipeline first, then the record, the model page and the meeting passage.`,
    );
    if (S.area !== "pipeline")
      await act(
        "Go to Pipeline",
        "SELECT_TAB",
        "tab.hub-pipeline",
        async () => go("pipeline"),
        selected("tab.hub-pipeline"),
      );
    await act(
      "Search “Halden”",
      "FOCUS + INPUT",
      "input.pipeline-search",
      async () => {
        S.search = "Halden";
        render();
      },
      () => $("#pipe-search")?.value === "Halden",
    );
    await act(
      "Filter: In diligence",
      "FILTER",
      "filter.stage-in_diligence",
      async () => {
        S.stage = "IN_DILIGENCE";
        render();
      },
      pressed("filter.stage-in_diligence"),
    );
    await act(
      "Open the first result",
      "SELECT_ITEM 1",
      "item.pipeline-1",
      async () => openRecord("halden", "overview"),
      exists("section.next-action"),
    );
    await act(
      "Tab: Intelligence & evidence",
      "SELECT_TAB",
      "tab.record-evidence",
      async () => {
        S.recordTab = "evidence";
        render();
      },
      selected("tab.record-evidence"),
    );
    await act(
      "Scroll to the margin claim",
      "SCROLL_TO",
      "item.claim-2",
      async () => {
        $('[data-q="item.claim-2"]').scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      },
      exists("item.claim-2"),
    );
    await act(
      "Open model v3 at page 7",
      "DOCUMENT_ACT GO_TO_PAGE 7",
      "button.claim-2-source",
      async () => {
        S.recordTab = "documents";
        S.docPage = 7;
        render();
      },
      () => $('[data-q="section.document-page"] strong')?.textContent === "7",
    );
    await act(
      "Jump to transcript 22:05",
      "SELECT_TAB + SCROLL_TO",
      "tab.record-meetings",
      async () => {
        S.recordTab = "meetings";
        S.transcriptAt = "22:05";
        render();
      },
      () => !!$("#ts-2205.hit"),
    );
    await say(
      `At 22:05 Amara asks which margin is current; at 22:41 the founder says hosting moved in-house. Next, the diligence brief job.`,
    );
    await act(
      "Tab: Q Work",
      "SELECT_TAB",
      "tab.record-work",
      async () => {
        S.recordTab = "work";
        render();
      },
      selected("tab.record-work"),
    );
    await act(
      "Open job: diligence brief",
      "ACTIVATE",
      "tab.record-work",
      async () => handle("work:w1"),
      exists("section.work-steps"),
    );
    await sleep(1400);
    await act(
      "Return to Halden Grid",
      "BACK",
      "button.work-back",
      async () => handle("return"),
      exists("section.next-action"),
    );
    await say(
      `Back on Halden Grid where you were. The margin stays contradictory until the hosting invoices arrive; I've suggested requesting them in Diligence.<div class="src faint">9 acts · all receipts from page read-back · simulated</div>`,
    );
  }

  /* ---------------- events ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    e.preventDefault();
    handle(el.getAttribute("data-action"), el);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "pipe-search") {
      S.search = e.target.value;
      render();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.matches('[data-form="q"]')) {
      e.preventDefault();
      const v = $("#q-input").value.trim();
      if (v) runCommand(v);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.drawer) {
      S.drawer = null;
      render();
    }
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
      const s = $("#pipe-search");
      if (s) {
        e.preventDefault();
        s.focus();
      }
    }
  });

  // Prototype API for scripted walkthroughs (Playwright recordings).
  window.HUB = { S, render, handle, runCommand, applyTheme, openRecord, go };

  const urlTheme = new URLSearchParams(location.search).get("theme");
  applyTheme(urlTheme || themeChoice());
  fromHash();
  render();
  window.addEventListener("hashchange", () => {
    Object.assign(S, {
      compare: false,
      qLog: [],
      qSay: null,
      drawer: null,
      transcriptAt: null,
      stage: null,
      search: "",
      qOpen: false,
    });
    fromHash();
    render();
    window.scrollTo(0, 0);
  });
})();
