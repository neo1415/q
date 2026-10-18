---
name: adr-0011-no-word-lists
description: "The user rejected regex/word-list \"patches\" for understanding what a person meant; ADR 0011 (2026-09-17) says a model reads meaning into a closed schema and code validates/confirms/executes"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T13:38:08.043Z
---

On 2026-09-17 the user said the day's fixes felt like "hardcoding different scenarios", "patching stuff together", "we will be fixing edge cases forever", and asked for a system that reads situations on its own, within the security constraints.

**Why:** three demos each produced a list of regex fixes (first-person routing, number words, "dot com", currency words, promise sentences). Each was right; together they only understand sentences already met.

**How to apply:** follow `docs/adr/0011-meaning-by-model-authority-by-code.md`. Add a new kind of meaning as a field on the surface's structured reading (interview conductor; company analyst v3 `profileUpdates`), never as a new regex over the words. Deterministic code validates, holds material readings for a yes, asks plainly when a reading fits nothing (never drops it silently), and executes consequential readings through the Approval Engine (`company.profile.update` is the model). Normalisations inside validators (number words, spoken URLs, currency in an amount) may stay. Related: [[no-unnecessary-builds]].
