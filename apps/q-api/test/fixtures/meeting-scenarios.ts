import type { HostParty } from "@capital-q/communication";

import { meetingFaceConfigFrom } from "../../src/composition/meeting-face.js";
import type { SimScenario } from "../meeting-simulator.js";

/**
 * Scripted meetings for the meeting simulator (synthetic people and
 * organisations only; no real person, company or meeting). Times are ms from
 * the booked start.
 */

const FOUNDER: HostParty = {
  userId: "00000000-0000-4000-8000-0000000000f1",
  name: "Adaeze Okafor",
  email: "adaeze@founder.example.test",
  side: "FOUNDER",
  organisation: "Nixo Labs",
};

const INVESTOR: HostParty = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  name: "Bayo Ade",
  email: "bayo@investor.example.test",
  side: "INVESTOR",
  organisation: "Zino Capital",
};

const SNAPSHOT = {
  shared: [
    {
      id: "booking",
      topic: "AGENDA" as const,
      text: "Nixo Labs seed round: first call between Nixo Labs and Zino Capital.",
      source: "booking",
    },
    {
      id: "rel",
      topic: "RELATIONSHIP" as const,
      text: "Zino Capital expressed interest in Nixo Labs on 2 November; Nixo Labs accepted on 4 November.",
      source: "relationship history",
    },
  ],
  disclosed: [
    {
      id: "deck-mrr",
      topic: "DECK" as const,
      text: "Monthly recurring revenue is $42,000 (deck, slide 6).",
      source: "deck:slide 6",
      truth: "USER_CLAIM" as const,
    },
    {
      id: "round",
      topic: "TERMS" as const,
      text: "Raising $1.5m on a post-money SAFE.",
      source: "deck:slide 11",
      truth: "USER_CLAIM" as const,
    },
  ],
  founderPrivate: [
    {
      id: "runway",
      topic: "COMPANY" as const,
      text: "PRIVATE-FOUNDER: runway is 7 months at current burn.",
      source: "founder workspace",
    },
  ],
  investorPrivate: [
    {
      id: "ic",
      topic: "MANDATE" as const,
      text: "PRIVATE-INVESTOR: investment committee meets on Thursdays; cheque ceiling $400k.",
      source: "investor workspace",
    },
  ],
};

const ANSWERS = [
  {
    when: /\bmonthly revenue\b|\bmrr\b/iu,
    line: "Nixo's deck states forty-two thousand dollars of monthly recurring revenue. That is their own figure, not yet verified.",
  },
  {
    when: /\braising\b/iu,
    line: "They are raising one and a half million dollars on a post-money SAFE, as the deck states.",
  },
  {
    when: /\bchurn\b/iu,
    line: "Churn isn't in anything this meeting has shared yet.",
  },
];

/** A first meeting: Q admitted from the lobby, a soft commitment, a diligence request. */
export const FIRST_MEETING_SOFT_COMMITMENT: SimScenario = {
  name: "first meeting: soft commitment and a diligence request",
  meetingId: "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f11",
  purpose: "Nixo Labs seed round",
  startsAt: "2026-11-20T10:00:00Z",
  minutes: 30,
  organiserUserId: INVESTOR.userId,
  parties: [FOUNDER, INVESTOR],
  priorMeetings: 0,
  snapshot: SNAPSHOT,
  face: "NONE",
  screens: true,
  admittedAt: 20_000,
  lobbyTimeoutMs: 600_000,
  answers: ANSWERS,
  steps: [
    { at: 5_000, kind: "JOIN", who: "Bayo Ade" },
    { at: 30_000, kind: "JOIN", who: "Adaeze Okafor" },
    {
      at: 45_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Good to finally meet you Adaeze, thanks for making the time.",
    },
    {
      at: 52_000,
      kind: "SAY",
      who: "Adaeze Okafor",
      text: "Likewise Bayo, happy to walk you through Nixo today.",
    },
    {
      at: 60_000,
      kind: "SCREEN",
      who: "Adaeze Okafor",
      frames: ["SLIDE-TRACTION", "SLIDE-TRACTION", "SLIDE-COHORTS"],
    },
    {
      at: 70_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Q what is Nixo's monthly revenue right now?",
    },
    {
      at: 85_000,
      kind: "SAY",
      who: "Adaeze Okafor",
      text: "That figure is from September and it has grown since.",
    },
    {
      at: 95_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "We will probably put in around two hundred and fifty thousand if diligence checks out.",
    },
    {
      at: 110_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "We'd likely come in at around a quarter of the round.",
    },
    {
      at: 125_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Could you send us the cohort retention data and the cap table by Friday?",
    },
    {
      at: 135_000,
      kind: "SAY",
      who: "Adaeze Okafor",
      text: "Yes I will send both by Friday.",
    },
    { at: 150_000, kind: "LEAVE", who: "Adaeze Okafor" },
    { at: 151_000, kind: "LEAVE", who: "Bayo Ade" },
  ],
};

/**
 * The face as configured by default (CQ_MEETING_FACE=on with the camera
 * page; decision 106): the note-taker shows it as its camera and it says
 * Q's lines with lip sync. A follow-up that does not say "Q" (Tavus would
 * hear "Q" as "Cue"; with echo it no longer listens at all).
 */
export const FACE_IN_MEET_FOLLOW_UP: SimScenario = {
  name: "the face is the note-taker's camera; an unnamed follow-up",
  meetingId: "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f12",
  purpose: "Nixo Labs seed round",
  startsAt: "2026-11-21T10:00:00Z",
  minutes: 30,
  organiserUserId: INVESTOR.userId,
  parties: [FOUNDER, INVESTOR],
  priorMeetings: 0,
  snapshot: SNAPSHOT,
  face: meetingFaceConfigFrom({ CQ_MEETING_FACE: "on" }, true).mode,
  screens: false,
  admittedAt: 10_000,
  lobbyTimeoutMs: 600_000,
  answers: ANSWERS,
  steps: [
    { at: 2_000, kind: "JOIN", who: "Bayo Ade" },
    { at: 3_000, kind: "JOIN", who: "Adaeze Okafor" },
    {
      at: 40_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Q how much is Nixo raising in this round?",
      tavusHears: "Cue how much is Nixo raising in this round?",
    },
    { at: 49_000, kind: "SAY", who: "Bayo Ade", text: "And what about churn?" },
    { at: 75_000, kind: "LEAVE", who: "Adaeze Okafor" },
    { at: 76_000, kind: "LEAVE", who: "Bayo Ade" },
  ],
};

/** A second meeting nobody admits Q to (5 of 13 live bots ended this way). */
export const SECOND_MEETING_NOT_ADMITTED: SimScenario = {
  name: "second meeting: Q left in the lobby",
  meetingId: "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f13",
  purpose: "Nixo Labs follow-up on diligence",
  startsAt: "2026-11-27T10:00:00Z",
  minutes: 30,
  organiserUserId: FOUNDER.userId,
  parties: [FOUNDER, INVESTOR],
  priorMeetings: 1,
  snapshot: SNAPSHOT,
  face: "NONE",
  screens: false,
  admittedAt: null,
  lobbyTimeoutMs: 120_000,
  answers: ANSWERS,
  steps: [
    { at: 1_000, kind: "JOIN", who: "Adaeze Okafor" },
    { at: 2_000, kind: "JOIN", who: "Bayo Ade" },
    {
      at: 30_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "We will commit five hundred thousand dollars, confirmed.",
    },
    { at: 150_000, kind: "LEAVE", who: "Adaeze Okafor" },
    { at: 151_000, kind: "LEAVE", who: "Bayo Ade" },
  ],
};

/**
 * A second meeting with the owner's sign-in configured (S1): the bot is
 * Capital Q's Workspace account and on the invite, so it is let straight
 * in; Q's opening and introductions know the sides have met before (S2).
 */
export const SECOND_MEETING_SIGNED_IN: SimScenario = {
  name: "second meeting: signed in, on the invite, 'again'",
  meetingId: "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f14",
  purpose: "Nixo Labs diligence follow-up",
  startsAt: "2026-11-28T10:00:00Z",
  minutes: 30,
  organiserUserId: FOUNDER.userId,
  parties: [FOUNDER, INVESTOR],
  priorMeetings: 1,
  inDiligence: true,
  botAccount: {
    loginGroupId: "login-group-sim-0001",
    inviteEmail: "q@capitalq.example.test",
  },
  snapshot: SNAPSHOT,
  face: "NONE",
  screens: false,
  admittedAt: null,
  lobbyTimeoutMs: 600_000,
  answers: ANSWERS,
  steps: [
    { at: 4_000, kind: "JOIN", who: "Adaeze Okafor" },
    { at: 9_000, kind: "JOIN", who: "Bayo Ade" },
    {
      at: 40_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Q what's the churn now?",
    },
    { at: 70_000, kind: "LEAVE", who: "Adaeze Okafor" },
    { at: 71_000, kind: "LEAVE", who: "Bayo Ade" },
  ],
};

/** A participant asks Q to leave mid-call (owner 2026-11-18): Q goes. */
export const ASKED_TO_LEAVE: SimScenario = {
  name: "a participant asks Q to leave",
  meetingId: "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f15",
  purpose: "Nixo Labs seed round",
  startsAt: "2026-11-29T10:00:00Z",
  minutes: 30,
  organiserUserId: INVESTOR.userId,
  parties: [FOUNDER, INVESTOR],
  priorMeetings: 0,
  snapshot: SNAPSHOT,
  face: "NONE",
  screens: false,
  admittedAt: 5_000,
  lobbyTimeoutMs: 600_000,
  answers: ANSWERS,
  steps: [
    { at: 1_000, kind: "JOIN", who: "Bayo Ade" },
    { at: 2_000, kind: "JOIN", who: "Adaeze Okafor" },
    {
      at: 40_000,
      kind: "SAY",
      who: "Adaeze Okafor",
      text: "We'd rather keep the rest of this between us.",
    },
    {
      at: 45_000,
      kind: "SAY",
      who: "Bayo Ade",
      text: "Q, please leave the call now.",
    },
    {
      at: 55_000,
      kind: "SAY",
      who: "Adaeze Okafor",
      text: "Our runway is seven months at current burn.",
    },
    { at: 80_000, kind: "LEAVE", who: "Adaeze Okafor" },
    { at: 81_000, kind: "LEAVE", who: "Bayo Ade" },
  ],
};
