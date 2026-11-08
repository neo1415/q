# Replay of the owner's 8 Nov session on batch 15 (74944dc22), fictional investor savanna-seed, labs, 1440

Run ~13:45 UTC. All four services SUCCESS on the first build.

| #   | Said                               | Pane                                 | Verdict                                                                                      |
| --- | ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| 2   | whats happening with my capital?   | /relationships?view=capital (1.1 s)  | OK                                                                                           |
| 3   | who has viewed me so far?          | /analytics (4.1 s)                   | OK                                                                                           |
| 5   | tell me about clinicrest           | Clinicrest (4.6 s)                   | OK; no stale "Want me to open…" in the captured answer                                       |
| 6   | take me to their chat              | Clinicrest messages (0.3 s)          | OK                                                                                           |
| 7   | what do i have in my pipeline?     | /relationships?view=pipeline (4.1 s) | OK                                                                                           |
| 9   | find paystack for me online now    | stays                                | **FIXED**: "Paystack is an African payments company…", with public, unverified, dated labels |
| 10  | what can you find online about me? | stays                                | OK                                                                                           |
