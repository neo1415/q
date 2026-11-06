# live25 — production check of f580935bb (6 Nov 2026, ~17:35 UTC)

Fictional investor, 1440×900, headless Chromium (fake mic for the voice check).

| Check                                                                           | Result                                                                                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat default; Q view presence                                                   | PASS                                                                                                                                                     |
| Q view inside a conversation (`?c=`)                                            | **PASS**: presence pinned and in view, current exchange under it, End shown (voice started on the Q click) (`4-q-in-conversation.png`)                   |
| Switch to Chat releases the mic                                                 | **PASS**: live tracks after Q 1, after Chat 0; both getUserMedia tracks (ElevenLabs probe, duplex line) ended. On d3829431a the duplex track stayed live |
| "find me new companies online that i would be interested in"                    | **PASS (discovery runs)** but thin: 1 company (valU, 4 founders). A stray tie line was appended. Round 6 asked: yield floor ≥5                           |
| "can you find more online? that maybe not exist in capital Q yet"               | **PASS**: "found 3 new companies"; none repeated from ask 1; founders 2/3; years shown; Series A labelled outside the stages                             |
| Normal question ("What is my mandate?") with the v2 Claude-backup routes active | PASS                                                                                                                                                     |
