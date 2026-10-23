# Q web search: live evidence, 23 Oct 2026

Probe: `scripts/handoff/live/web-search-live.mjs` (founder.maji-loop, Home, a fresh conversation per prompt). First word = Q's own reply text appearing after the question. Sources = external links on the answer. Pictures = `[data-q-picture]` images that loaded.

| Deploy (UTC)                         | Prompt                     | First word | Done   | Sources | Pictures |
| ------------------------------------ | -------------------------- | ---------- | ------ | ------- | -------- |
| 766067719, 08:33 (before Brave)      | Zino Aviation and its team | 9.4 s      | 13.5 s | 0       | 0        |
|                                      | Who is Captain Zino Mario? | 2.9 s      | 3.4 s  | 0       | 0        |
|                                      | Latest news on Flutterwave | 3.0 s      | 10.0 s | 0       | 0        |
| f5a264370, 09:43 (Brave, #338, #339) | Zino Aviation and its team | 8.9 s      | 13.4 s | 5       | 0        |
|                                      | Who is Captain Zino Mario? | 2.5 s      | 3.5 s  | 2       | 0        |
|                                      | Latest news on Flutterwave | 3.0 s      | 9.3 s  | 6       | 4        |

**Before Brave.** Every answer said public search was unavailable: Tavily, Serper and ScrapingBee all failed. There were no "can't browse" excuses.

**After Brave.**

- **Zino Aviation and its team** — sources: zinoaviation.com, its LinkedIn company page, facebook.com/zinoaviation, plus two off-topic pages (slaynews plane crash, robbreport jet charter). The answer says the facts are from public sources: an aviation management and pilot-training consultancy founded in 2018 by Captain Zino; no team list established. It also gives the Capital Q record (interest expressed). No picture.
- **Who is Captain Zino Mario?** — this went through the person-search lane. The answer was "only a name match so far", with 2 zinoaviation.com sources and a candidate card. No picture.
- **Latest news on Flutterwave** — found the Semafor report of 17 Jun 2026 (M&A, Ripple investment) and said the newer status isn't established. Also cited Wikipedia, Forbes and Crunchbase, plus Dribbble and Behance search pages. The pictures are Dribbble design shots: wrong kind of picture.

## Open defects

1. The Zino Aviation turn still takes about 9 s to first word: the early "checking what's public" line doesn't fire on that turn.
2. Off-topic hits pass into the sources.
3. Picture selection lets design galleries (Dribbble, Behance) through.
4. The person lane returns no picture for Captain Zino Mario.
