---
name: python-file-writes-flip-to-crlf
description: "Editing a repo file with Python's io.open(p, \"w\") on this Windows box rewrites every line ending as CRLF, so git shows a whole-file diff; pass newline=\"\" on both read and write"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-23T05:29:59.417Z
---

`io.open(path, "w", encoding="utf-8")` uses universal newline translation, so every `\n` written becomes `\r\n`. The repo is LF, so a three-line edit lands as a 700-line diff and the change itself becomes unreviewable. It happened twice during QX-004 — once to `.gitignore` (caught before committing) and once to `interviewer-confirmation.test.ts` and `interview-conductor.v5.ts`, which were committed with CRLF and had to be normalised in the next commit. The Edit tool and prettier do not fix it; they preserve whatever the file already has.

**Why:** Python's text mode translates on write unless told not to. `newline=""` disables translation in both directions.

**How to apply:** always `io.open(p, encoding="utf-8", newline="")` for the read AND `io.open(p, "w", encoding="utf-8", newline="")` for the write. Check before staging with `git diff --stat` — an implausible line count on a small edit is this. To find files already flipped: `git grep -lI $'\r' HEAD -- '*.ts' '*.tsx' '*.json'`, then rewrite with `io.open(f,"wb").write(raw.replace(b"\r\n", b"\n"))`, leaving `.railway/README.md` alone because it is CRLF upstream. Also note a plain `s.replace(a, b, 1)` with no assert silently does nothing when the anchor has already changed — assert the anchor. Related: [[bash-heredoc-collapses-backslashes]].
