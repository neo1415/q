---
title: The founder's global Claude rules, adapted for the cloud
project: capital-q
date: 2026-09-26
tags: [handoff, cloud, graphify, workflow]
---

# Global Claude rules, adapted for the cloud

On the laptop, the founder's `~/.claude/CLAUDE.md` applied to every project. A cloud session does not have that file. These are the parts that matter for Capital Q, adapted to a cloud VM. Repo `CLAUDE.md` still wins where they differ.

## 1. Context navigation (token discipline)

Before reading raw source to answer a codebase question, go through these layers in order and stop at the first that answers it:

1. **Knowledge graph.** If `graphify-out/graph.json` exists, run `graphify query "<question>"` (scoped subgraph; default budget 2000 tokens, pass `--budget 1500` or lower to save). Use `graphify path "<A>" "<B>"` for how two things connect, `graphify explain "<node>"` for one concept, `graphify affected "<node>"` for blast radius, `graphify god-nodes` for the architectural hubs. Read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review.
2. **Handoff notes** (the laptop used an Obsidian vault here; see section 3): `docs/handoff/research/ledger.md` (last ~60 lines), `docs/handoff/memory/`, the ADRs, and the two most recent files in `docs/handoff/logs/`.
3. **Raw files.** Only then open source files, and open the specific file the graph pointed at rather than browsing directories.

## 2. graphify in the cloud

- Install: `pip install graphifyy` (Python package with two y's; command `graphify`). Put it in the environment setup script so it is cached.
- Build or refresh: `graphify update .` from the repo root. AST only, no API cost. Run it after each merge onto recovery.
- **Never** run semantic (LLM) extraction over the whole repository without the founder's say-so. If you need semantic extraction, use `--code-only` or a subfolder.
- Output lives in `graphify-out/` at the repo root. It must never be committed. The laptop ignored it through a global gitignore that the cloud does not have, so add it locally instead: `echo graphify-out/ >> .git/info/exclude` (do not edit the repo `.gitignore` for tooling). Also exclude `.graphify_python` if graphify writes it. If graphify writes a `.gitattributes`, do not commit that either.
- `pnpm format:check` walks `graphify-out/`; warnings under that folder are not failures.
- There is no git post-commit hook in the cloud clone; run `graphify update .` yourself.

## 3. Vault conventions, adapted

On the laptop, notes lived in an Obsidian vault at `C:/Users/DELL/Desktop/vault` (per-project folder `vault/capital-q/` with `decisions.md` and `logs/`). **That vault does not exist in the cloud and must never be committed into the repo.** Its durable content is already represented in the repo: the ADRs, `docs/handoff/research/ledger.md`, `docs/handoff/memory/`, and the module docs under `docs/modules/`.

In the cloud, instead:

- **Session logs:** at the end of a substantial session write `docs/handoff/logs/YYYY-MM-DD-<topic>.md`, under 40 lines, using the template below. Kebab-case filenames, YAML frontmatter.
- **Durable decisions** (not progress): one dated bullet each, with the reason, in the ledger under a "Decisions" line, or as an ADR in `docs/adr/` when it amends architecture.
- **Lessons that should survive sessions** (the laptop's auto-memory): add a file to `docs/handoff/memory/` with the same frontmatter shape and one line in its `MEMORY.md` index. Never put a secret value in it.
- Nothing else: no `graphify-out/`, no `.claude/`, no vault export, no personal notes in the repo.

Session log template:

```markdown
---
title: <topic>
project: capital-q
date: YYYY-MM-DD
tags: [session-log]
---

# <topic>

**Objective:** one sentence.

**What changed**

- `path/to/file`: what and why

**Decisions**

- decision: reason (durable ones also go in the ledger or an ADR)

**Open questions**
-

**Next step**
-
```

## 4. Not carried over

- The laptop's Windows-specific notes (MSIX virtualised AppData, WMI-detached demo launch, PowerShell `demo:*` scripts, CRLF traps from Python on Windows, the Claude desktop app killing its child processes) do not apply on a Linux VM. They stay in `docs/handoff/memory/` as history.
- The `songscribe` project entry in the global file is unrelated to Capital Q.
