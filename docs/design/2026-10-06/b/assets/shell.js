// Shared mockup shell: theme and brand from the URL, icons, the app frame.
export const params = new URLSearchParams(location.search);
const root = document.documentElement;
root.dataset.theme = params.get("theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
if (params.get("brand")) root.dataset.brand = params.get("brand");
export const reduced = params.get("motion") === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;

const P = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4v2H6v-2l4-4z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  bank: '<path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevd: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
  hand: '<path d="M7 11V6a2 2 0 0 1 4 0v5M11 10V4a2 2 0 0 1 4 0v6M15 10V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3 14a2 2 0 0 1 3.4-2l.6 1"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2 2.7.8 2.7 2-1.1 2-2.7 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5"/>',
};
export const icon = (name, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? ""}</svg>`;

export const qMark = (size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const NAV = [
  ["discover", "Discover", "compass"],
  ["q", "Q", null],
  ["capital", "Capital", "bank"],
  ["relationships", "Relationships", "users"],
  ["work", "Work", "work"],
];

export function shell(current, mainHtml) {
  const link = ([id, label, ic]) =>
    `<a href="#" ${id === current ? 'aria-current="page"' : ""}>${ic ? icon(ic) : qMark(20)}<span>${label}</span></a>`;
  const theme = root.dataset.theme;
  return `<div class="shell">
    <nav class="side" aria-label="Main">
      <div class="brandmark">${qMark(24)}<span>Capital Q</span></div>
      <div class="nav">${NAV.map(link).join("")}</div>
      <div class="side-foot"><div class="seg" role="group" aria-label="Theme">
        <button aria-pressed="${theme === "light"}">Light</button><button aria-pressed="false">Device</button><button aria-pressed="${theme === "dark"}">Dark</button>
      </div></div>
    </nav>
    <main class="main" id="main">${mainHtml}</main>
    <nav class="tabbar" aria-label="Main">${NAV.map(link).join("")}</nav>
  </div>`;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
