import { keep, summarise, twoSteps } from "./build.js";
import type { LongAnswerCaseInput } from "./contracts.js";

/**
 * The held-out split (DECISIONS 72: at least 30%), written separately and
 * never tuned against: a live run reports its misses by category only.
 * Fictional people and companies only.
 */
const heldout = "heldout" as const;

export const LONG_ANSWER_HELDOUT: readonly LongAnswerCaseInput[] = [
  keep(
    {
      id: "ho-typed-01",
      split: heldout,
      side: "FOUNDER",
      category: "LONG_CLEAR_TYPED",
      mode: "TYPED",
    },
    "F9.why_us_why_now",
    "We spent eight years running the claims desk at a regional insurer, so we know where the delays happen. Insurers have to digitise claims under the new EU rules from 2027, and the incumbents' software was built for paper, which gives a small team a window right now.",
  ),
  keep(
    {
      id: "ho-typed-02",
      split: heldout,
      side: "INVESTOR",
      category: "LONG_CLEAR_TYPED",
      mode: "TYPED",
    },
    "I11.additional_context",
    "We are a two-partner fund, so founders always deal with a decision maker. We do one call, one data room review and one partner meeting, and we tell founders yes or no within three weeks of the first call.",
  ),
  summarise(
    {
      id: "ho-ramble-01",
      split: heldout,
      side: "FOUNDER",
      category: "RAMBLING_SPOKEN",
      mode: "SPOKEN",
    },
    "F9.solution",
    "Right so the solution, um, so what we built is, it's like a, a dashboard, but not just a dashboard, it's, uh, it connects to the, the machines on the factory floor, the CNC machines mostly, and, you know, it tells the, the supervisor when one's going to, like, go down, before it goes down, and, um, it also, it also orders the part, sometimes, if, if they set that up, yeah.",
    "Connects to CNC machines on the factory floor, warns the supervisor before a machine goes down, and can order the replacement part.",
    ["CNC"],
  ),
  summarise(
    {
      id: "ho-ramble-02",
      split: heldout,
      side: "INVESTOR",
      category: "RAMBLING_SPOKEN",
      mode: "SPOKEN",
    },
    "I8.portfolio",
    "Our portfolio, um, it's, so we've done, what, I think 22, 22 deals, yeah, and, uh, a lot of them are fintech, fintech and, and some insurance stuff, insurtech, and, like, the biggest one is, is Payloom, Payloom, which, you know, people know, and, um, that's, that's the main one.",
    "22 investments, mostly fintech and insurtech; the best known is Payloom.",
    ["22", "Payloom"],
  ),
  summarise(
    {
      id: "ho-short-ramble-01",
      split: heldout,
      side: "FOUNDER",
      category: "SHORT_RAMBLE",
      mode: "SPOKEN",
    },
    "F9.business_model",
    "We, um, we take, like, a cut, a small cut, you know, of the, the bookings, the bookings.",
    "Takes a small commission on each booking.",
  ),
  summarise(
    {
      id: "ho-short-ramble-02",
      split: heldout,
      side: "INVESTOR",
      category: "SHORT_RAMBLE",
      mode: "SPOKEN",
    },
    "I6.custom_criteria",
    "Founders, I mean, like, good founders, the founders, you know, matter most, most for us, really.",
    "The quality of the founders matters most.",
  ),
  keep(
    {
      id: "ho-clear-spoken-01",
      split: heldout,
      side: "INVESTOR",
      category: "CLEAR_SPOKEN_FILLER",
      mode: "SPOKEN",
    },
    "I6.custom_criteria",
    "Uh, we invest in seed-stage B2B software in the Nordics, and we like to see a founder who has worked in the industry they're selling to.",
    "We invest in seed-stage B2B software in the Nordics, and we like to see a founder who has worked in the industry they're selling to.",
  ),
  keep(
    {
      id: "ho-clear-spoken-02",
      split: heldout,
      side: "FOUNDER",
      category: "CLEAR_SPOKEN_FILLER",
      mode: "SPOKEN",
    },
    "F1.description",
    "So, we run a tutoring service that pairs, um, university students with secondary school pupils in maths and physics, online, for about half the price of an agency.",
    "We run a tutoring service that pairs university students with secondary school pupils in maths and physics, online, for about half the price of an agency.",
  ),
  keep(
    {
      id: "ho-list-01",
      split: heldout,
      side: "FOUNDER",
      category: "LIST",
      mode: "TYPED",
    },
    "F9.competition",
    "Our competitors are: Rotaplan (enterprise only, 6-month rollouts); ShiftBee (cheap, but no payroll link); and spreadsheets, which is what 70% of our customers used before us.",
  ),
  twoSteps(
    {
      id: "ho-two-01",
      split: heldout,
      side: "FOUNDER",
      category: "TWO_STEPS",
      mode: "SPOKEN",
    },
    "What does the company do, and how do you make money?",
    "We sell refurbished office furniture to startups in Berlin, and we make money on the margin between what we pay at liquidations and the resale price, usually around 35%.",
    [
      {
        stepKey: "F1.description",
        summary: "Sells refurbished office furniture to startups in Berlin.",
        mustKeep: ["Berlin"],
      },
      {
        stepKey: "F9.business_model",
        summary:
          "Earns the margin between what it pays at liquidations and the resale price, usually around 35%.",
        mustKeep: ["35"],
      },
    ],
  ),
  keep(
    {
      id: "ho-correction-01",
      split: heldout,
      side: "FOUNDER",
      category: "CORRECTION",
      mode: "SPOKEN",
    },
    "F9.problem",
    "Independent pharmacies in Ireland, sorry, in Ireland and Northern Ireland, spend about 6 hours a week reconciling wholesaler invoices by hand.",
    "Independent pharmacies in Ireland and Northern Ireland spend about 6 hours a week reconciling wholesaler invoices by hand.",
  ),
  keep(
    {
      id: "ho-non-native-01",
      split: heldout,
      side: "INVESTOR",
      category: "NON_NATIVE",
      mode: "TYPED",
    },
    "I11.additional_context",
    "For us is very important that founder is answering fast and is honest about the numbers, also when the numbers are not good.",
  ),
  keep(
    {
      id: "ho-figures-01",
      split: heldout,
      side: "FOUNDER",
      category: "FIGURES",
      mode: "TYPED",
    },
    "F9.opportunity",
    "There are about 26,000 independent garages in France, and each spends roughly 4,000 euros a year on diagnostic software, so the market we can reach directly is around 100 million euros a year.",
  ),
  keep(
    {
      id: "ho-short-clear-01",
      split: heldout,
      side: "FOUNDER",
      category: "SHORT_CLEAR",
      mode: "TYPED",
    },
    "F9.vision",
    "Every small farm in Europe selling direct to its customers.",
  ),
];
