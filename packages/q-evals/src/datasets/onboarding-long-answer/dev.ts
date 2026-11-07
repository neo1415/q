import { keep, summarise, twoSteps } from "./build.js";
import type { LongAnswerCaseInput } from "./contracts.js";

/** The dev split: tuned against. Fictional people and companies only. */
const dev = "dev" as const;

export const LONG_ANSWER_DEV: readonly LongAnswerCaseInput[] = [
  // A long but clear typed answer: kept whole.
  keep(
    {
      id: "dev-typed-01",
      split: dev,
      side: "FOUNDER",
      category: "LONG_CLEAR_TYPED",
      mode: "TYPED",
    },
    "F1.description",
    "We build inventory software for independent bike shops in Germany and Austria. Shops connect their till and their suppliers' catalogues, and the system reorders parts automatically before they run out, so mechanics stop waiting on spares and owners stop tying cash up in slow stock.",
  ),
  keep(
    {
      id: "dev-typed-02",
      split: dev,
      side: "INVESTOR",
      category: "LONG_CLEAR_TYPED",
      mode: "TYPED",
    },
    "I6.custom_criteria",
    "We look for technical founders selling to industrial companies, with at least one paying pilot and a clear reason the buyer cannot build it in house. We avoid consumer apps and anything that depends on a single large customer for more than half of revenue.",
  ),
  keep(
    {
      id: "dev-typed-03",
      split: dev,
      side: "FOUNDER",
      category: "LONG_CLEAR_TYPED",
      mode: "TYPED",
    },
    "F9.problem",
    "Small dairy farms in Ireland lose milk revenue because they only find out about quality problems when the co-op tests the tank, days after collection. By then the penalty is applied and the cause is gone. Nobody gives the farmer a reading at milking time, when they could still act on it.",
  ),
  // A rambling spoken answer: summarised.
  summarise(
    {
      id: "dev-ramble-01",
      split: dev,
      side: "FOUNDER",
      category: "RAMBLING_SPOKEN",
      mode: "SPOKEN",
    },
    "F1.description",
    "So, um, basically what we do, and it's a bit hard to explain, is we, we work with, like, hospitals, well not just hospitals, clinics too, and we help them with their, you know, their scheduling of nurses, the shifts, because right now it's all, I mean it's all spreadsheets, and, uh, so we make an app that, sort of, does the rota, the nurse rota, automatically, and it, it kind of learns who likes which shifts, and yeah, that's, that's basically it, we're in Leeds.",
    "Builds an app that plans nurse shift rotas for hospitals and clinics automatically, learning which shifts staff prefer; based in Leeds.",
    ["Leeds"],
  ),
  summarise(
    {
      id: "dev-ramble-02",
      split: dev,
      side: "INVESTOR",
      category: "RAMBLING_SPOKEN",
      mode: "SPOKEN",
    },
    "I6.custom_criteria",
    "Yeah so what we look for, I mean it changes, but, um, mostly it's the team, the team really, and, uh, you know, whether they've, whether they've sold before, sold into enterprise I mean, and the market, the market has to be big, like, we want to see a path to, I don't know, 100 million in revenue, and, uh, we like B2B, mostly B2B, sometimes we'll, we'll look at other things but mostly B2B, yeah.",
    "Backs mostly B2B teams with enterprise sales experience, in large markets with a path to 100 million in revenue.",
    ["100", "B2B"],
  ),
  summarise(
    {
      id: "dev-ramble-03",
      split: dev,
      side: "FOUNDER",
      category: "RAMBLING_SPOKEN",
      mode: "SPOKEN",
    },
    "F9.business_model",
    "OK so the money, right, so, um, we charge, well, there's two things, there's the, the setup fee which is, it's about 2,000 euros, and then, and then there's the monthly, which is, like, per location, per location per month, around 150, and, uh, we're thinking maybe later we'd, we'd do something with payments but not now, not now, so yeah, setup and then monthly per location.",
    "A setup fee of about 2,000 euros plus around 150 euros per location per month; payments may come later.",
    ["2,000", "150"],
  ),
  // A short ramble: summarised however short.
  summarise(
    {
      id: "dev-short-ramble-01",
      split: dev,
      side: "FOUNDER",
      category: "SHORT_RAMBLE",
      mode: "SPOKEN",
    },
    "F1.description",
    "So we, uh, we basically, you know, help, I mean we help cafes, cafes and bakeries, like, sell their leftover bread, the leftover stuff, at night.",
    "Helps cafes and bakeries sell their leftover bread at night.",
  ),
  summarise(
    {
      id: "dev-short-ramble-02",
      split: dev,
      side: "INVESTOR",
      category: "SHORT_RAMBLE",
      mode: "SPOKEN",
    },
    "I11.additional_context",
    "Um, we, we like to, like, be quick, quick on decisions I mean, like, we, you know, decide fast, usually, usually two weeks.",
    "Decides quickly, usually within two weeks.",
    ["two"],
  ),
  summarise(
    {
      id: "dev-short-ramble-03",
      split: dev,
      side: "FOUNDER",
      category: "SHORT_RAMBLE",
      mode: "SPOKEN",
    },
    "F9.problem",
    "The problem is, well, the problem is, um, landlords, landlords don't, they don't know, like, when the boilers are going to break, you know, they just break.",
    "Landlords cannot tell when their boilers are about to break.",
  ),
  // A clear spoken answer with light filler: kept, cleaned.
  keep(
    {
      id: "dev-clear-spoken-01",
      split: dev,
      side: "FOUNDER",
      category: "CLEAR_SPOKEN_FILLER",
      mode: "SPOKEN",
    },
    "F1.description",
    "Um, we make a booking app for padel clubs in Spain, so players can find a court, pay, and split the cost with their friends, and the club sees its occupancy in one place.",
    "We make a booking app for padel clubs in Spain, so players can find a court, pay, and split the cost with their friends, and the club sees its occupancy in one place.",
  ),
  keep(
    {
      id: "dev-clear-spoken-02",
      split: dev,
      side: "INVESTOR",
      category: "CLEAR_SPOKEN_FILLER",
      mode: "SPOKEN",
    },
    "I8.portfolio",
    "So we have, uh, eleven companies in the portfolio, mostly logistics software, and our best known is probably Freightwise, which we led at seed in 2023.",
    "We have eleven companies in the portfolio, mostly logistics software, and our best known is probably Freightwise, which we led at seed in 2023.",
  ),
  keep(
    {
      id: "dev-clear-spoken-03",
      split: dev,
      side: "FOUNDER",
      category: "CLEAR_SPOKEN_FILLER",
      mode: "SPOKEN",
    },
    "F9.solution",
    "Our solution is, um, a small sensor that clips onto the water meter and sends readings every hour, and the app flags a leak, you know, within a day instead of at the next bill.",
    "Our solution is a small sensor that clips onto the water meter and sends readings every hour, and the app flags a leak within a day instead of at the next bill.",
  ),
  // Lists: a clear list is kept; a rambling spoken one is summarised.
  keep(
    {
      id: "dev-list-01",
      split: dev,
      side: "FOUNDER",
      category: "LIST",
      mode: "TYPED",
    },
    "F9.go_to_market",
    "Three channels: 1) direct sales to the 40 largest regional grocers, 2) a reseller deal with Kassa Systems, who already sell tills to 900 stores, and 3) trade fairs in Utrecht and Ghent twice a year.",
  ),
  keep(
    {
      id: "dev-list-02",
      split: dev,
      side: "INVESTOR",
      category: "LIST",
      mode: "TYPED",
    },
    "I6.custom_criteria",
    "What we need to see: a product in market; at least 10 paying customers; a founder who owns the sales process; gross margin above 60%; and a round where we can take a board observer seat.",
  ),
  summarise(
    {
      id: "dev-list-03",
      split: dev,
      side: "FOUNDER",
      category: "LIST",
      mode: "SPOKEN",
    },
    "F9.go_to_market",
    "Well, how we sell, it's, um, a few things, like, there's, there's direct, we do direct, and then partners, partners a bit, and, uh, events, well, events we tried, events didn't really work, so, so mostly direct and partners, I guess, and LinkedIn, LinkedIn a bit too.",
    "Mostly direct sales and partners, with some LinkedIn; events were tried and did not work.",
    ["LinkedIn"],
  ),
  // One line answering two steps: a summary for each.
  twoSteps(
    {
      id: "dev-two-01",
      split: dev,
      side: "FOUNDER",
      category: "TWO_STEPS",
      mode: "TYPED",
    },
    "What problem are you solving, and what have you built?",
    "Freelance translators lose hours chasing invoices from agencies that pay late. We built a tool that sends the invoice, tracks it, and advances 80% of it the day the agency approves it.",
    [
      {
        stepKey: "F9.problem",
        summary:
          "Freelance translators lose hours chasing late-paying agencies for their invoices.",
      },
      {
        stepKey: "F9.solution",
        summary:
          "A tool that sends and tracks invoices and advances 80% of each one when the agency approves it.",
        mustKeep: ["80"],
      },
    ],
  ),
  twoSteps(
    {
      id: "dev-two-02",
      split: dev,
      side: "INVESTOR",
      category: "TWO_STEPS",
      mode: "SPOKEN",
    },
    "What do you look for, and what have you backed so far?",
    "We back climate hardware at seed, things like heat pumps and grid storage, and so far we've done 6 deals, including Voltreen and Coolstack.",
    [
      {
        stepKey: "I6.custom_criteria",
        summary:
          "Backs climate hardware at seed, such as heat pumps and grid storage.",
      },
      {
        stepKey: "I8.portfolio",
        summary: "6 investments so far, including Voltreen and Coolstack.",
        mustKeep: ["6", "Voltreen", "Coolstack"],
      },
    ],
  ),
  // A correction mid-answer: the corrected part is left out, nothing else.
  keep(
    {
      id: "dev-correction-01",
      split: dev,
      side: "FOUNDER",
      category: "CORRECTION",
      mode: "SPOKEN",
    },
    "F1.description",
    "We run a marketplace for used lab equipment in the Netherlands, sorry, in the Benelux, so universities can sell instruments they no longer need to startups.",
    "We run a marketplace for used lab equipment in the Benelux, so universities can sell instruments they no longer need to startups.",
  ),
  keep(
    {
      id: "dev-correction-02",
      split: dev,
      side: "INVESTOR",
      category: "CORRECTION",
      mode: "TYPED",
    },
    "I11.additional_context",
    "We usually reply within a week, sorry, within ten days, and we always give a reason when we pass.",
    "We usually reply within ten days, and we always give a reason when we pass.",
  ),
  keep(
    {
      id: "dev-correction-03",
      split: dev,
      side: "FOUNDER",
      category: "CORRECTION",
      mode: "SPOKEN",
    },
    "F9.business_model",
    "We charge 3%, sorry, 2.5% of each transaction, capped at 40 euros per transfer, and nothing on refunds.",
    "We charge 2.5% of each transaction, capped at 40 euros per transfer, and nothing on refunds.",
  ),
  // Non-native English: clear is kept as written, never corrected.
  keep(
    {
      id: "dev-non-native-01",
      split: dev,
      side: "FOUNDER",
      category: "NON_NATIVE",
      mode: "TYPED",
    },
    "F1.description",
    "We are making platform for the small farmers in Kenya for sell their milk direct to the buyers, without middleman who is taking big part of the price.",
  ),
  keep(
    {
      id: "dev-non-native-02",
      split: dev,
      side: "INVESTOR",
      category: "NON_NATIVE",
      mode: "SPOKEN",
    },
    "I6.custom_criteria",
    "Eh, we are investing in the companies of software for the hospitals, in Brazil and Mexico, when they have already the first clients that are paying.",
    "We are investing in the companies of software for the hospitals, in Brazil and Mexico, when they have already the first clients that are paying.",
  ),
  summarise(
    {
      id: "dev-non-native-03",
      split: dev,
      side: "FOUNDER",
      category: "NON_NATIVE",
      mode: "SPOKEN",
    },
    "F9.problem",
    "So the problem, eh, the problem is that, how you say, the restaurants, they throw, they throw much food, much food every day, and they don't know, eh, they don't know how much they will sell, so they cook too much, too much, every day the same.",
    "Restaurants throw away a lot of food every day because they cannot predict how much they will sell, so they cook too much.",
  ),
  // Figures: kept exactly when clear; a summary keeps every one.
  keep(
    {
      id: "dev-figures-01",
      split: dev,
      side: "FOUNDER",
      category: "FIGURES",
      mode: "TYPED",
    },
    "F9.business_model",
    "Clinics pay 89 euros per therapist per month on an annual contract; 140 clinics are paying today, which is about 150,000 euros in annual recurring revenue.",
  ),
  summarise(
    {
      id: "dev-figures-02",
      split: dev,
      side: "FOUNDER",
      category: "FIGURES",
      mode: "SPOKEN",
    },
    "F9.business_model",
    "So, revenue, um, we, we make money from, from subscriptions, mostly, it's, uh, 49 a month, 49 pounds, for the basic, and, like, 129 for the, the pro one, and, um, we've got, I think, about 1,200 subscribers now, roughly 1,200, yeah.",
    "Subscriptions at 49 pounds a month for the basic plan and 129 for the pro plan, with about 1,200 subscribers.",
    ["49", "129", "1,200"],
  ),
  keep(
    {
      id: "dev-figures-03",
      split: dev,
      side: "INVESTOR",
      category: "FIGURES",
      mode: "TYPED",
    },
    "I8.portfolio",
    "Fund I is 40 million euros; we have made 18 investments, 3 have been acquired, and we keep about half the fund for follow-ons.",
  ),
  // A short clear answer: kept, nothing to say back.
  keep(
    {
      id: "dev-short-clear-01",
      split: dev,
      side: "FOUNDER",
      category: "SHORT_CLEAR",
      mode: "TYPED",
    },
    "F1.description",
    "Payroll software for restaurants in Portugal.",
  ),
  keep(
    {
      id: "dev-short-clear-02",
      split: dev,
      side: "INVESTOR",
      category: "SHORT_CLEAR",
      mode: "TYPED",
    },
    "I11.additional_context",
    "We only lead rounds; we never follow.",
  ),
];
