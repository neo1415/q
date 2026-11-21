// W4-A: the hand catalogues registered as the server registers them at
// start, so a test that renders or translates Arabic reads it at once
// (the browser loads it on demand; language.tsx waits for it).
import "@/features/i18n/hand-server";
