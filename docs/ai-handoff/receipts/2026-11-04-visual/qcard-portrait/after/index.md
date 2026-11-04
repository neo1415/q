# Q Card on production with a demo logo — 2026-11-04

These are production screenshots on web `11c36f6ea`, which includes `feat/qcard-portrait` `2531bede1`. Account: `investor.savanna-seed@fictional.capitalq.local` (fictional).

The owner approved this session to upload demo images on production. Both went through the app's own image editors on `/profile`; the toasts read "Logo updated." and "Profile photo updated.". Both images were generated for this test and show no real person or brand:

- firm logo: an abstract gold sun on charcoal;
- person photo: a grey silhouette.

| File                                     | Shows                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prod-qcard-{light,dark}-{1440,390}.png` | One Q Card section. The firm card shows the uploaded logo instead of "SP" initials. "Your personal Q Card" is collapsed below it.                                                         |
| `prod-personal-qcard-light-1440.png`     | The personal section expanded. This fictional person has no personal card yet, so only the create form shows. Creating one would claim a public handle on production, which was not done. |

**Open finding (390 px):** the firm name and handle truncate ("Savanna Seed…", "savanna-seed-…") because the QR takes about 45% of the card width. Suggested fix: on narrow screens, put the QR below the identity block, or shrink it.
