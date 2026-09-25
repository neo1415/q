---
name: bash-heredoc-collapses-backslashes
description: "In this environment a Bash-tool heredoc collapses `\\\\` to `\\` (so `\\\\b` becomes a literal backspace in Python source); write scripts with the Write tool instead of inline heredocs"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-18T14:12:31.135Z
---

Inline `python - <<'EOF' ... EOF` blocks in the Bash tool have their double backslashes collapsed before Python sees them, so regex text like `\\b` or `\\s` arrives as `\b` (a backspace byte) or an invalid escape. During CQ-REC-003 this planted three 0x08 bytes into a test regex that eslint then flagged (`no-control-regex`); sed and the Edit tool could not see them either.

**Why:** the tool's argument escaping is applied even to quoted heredocs.

**How to apply:** write any Python or Node script that contains backslashes to the scratchpad with the Write tool and run it by path (`python <scratchpad>/x.py`); keep inline heredocs for backslash-free text. When a regex "should match but doesn't", check for control bytes with `grep -c $'\x08'`. Related: [[lint-heap-and-gates]].
