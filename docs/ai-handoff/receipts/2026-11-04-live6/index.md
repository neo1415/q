# Live verification 6: 7b9a267ce (4 Nov 2026)

These checks used the fictional investor `investor.savanna-seed@fictional.capitalq.local` at 1440 and 390 px, with 5 Q turns and no approvals. Full detail is in `results.json`.

Deploy: the integration owner pushed `11c36f6ea` → `7b9a267ce`. Web, api, q-api and workers were all SUCCESS at 22:52:54Z.

| Check                                         | Result | Observed                                                                                                                                                                                  |
| --------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Back on interior pages, none on root pages | PASS   | Company → "Discover", /settings/plan → "Settings", relationship record → "CRM"; none on /home, /discover or /relationships                                                                |
| 2. One-page Ledgerline memo                   | FAIL   | Uses Ledgerline's own record and has no doubled sentences, but the PDF is **2 pages**. The chat shows raw "## Key Gaps and Risks"; the PDF ends with "The memo text is ready for review." |
| 3. Compare 2nd and 3rd, then traction         | PASS   | Mizan (EGP 640m, 0.9% NPL) and Silo Credit (₦2.1bn, under 0.5% loss) each keep their own figures                                                                                          |
| 4. Pipeline counts                            | PASS   | Q: 12 = 1 diligence + 8 connected + 3 awaiting reply; Relationships shows the same counts                                                                                                 |
| 5. Discover logos                             | PASS   | Harbourline "HC" logo renders; Ledgerline shows a neutral placeholder                                                                                                                     |
| 6. Q Card at 390                              | PASS   | Full "Savanna Seed Partners", with the QR below                                                                                                                                           |
