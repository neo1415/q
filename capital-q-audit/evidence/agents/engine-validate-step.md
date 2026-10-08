# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 607-965

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 607-965 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: validateStep: every code-side refusal/ask/auto decision for a planned step (grant, scope, connection, message checks, consider step, delegation, caps).

```ts
  607  export function validateStep(
  608    step: InstructionPlanStep,
  609    context: ValidationContext,
  610  ): StepVerdict {
  611    const action = context.actions.find(
  612      (candidate) =>
  613        candidate.name === step.action &&
  614        candidate.classification === "CONSEQUENTIAL",
  615    );
  616    if (action === undefined) {
  617      return { verdict: "REFUSED", code: "UNKNOWN_ACTION", relationshipId: null };
  618    }
  619    const granted = context.grant.actions.find(
  620      (entry) => entry.action === action.name,
  621    );
  622    if (granted === undefined) {
  623      return { verdict: "REFUSED", code: "NOT_IN_GRANT", relationshipId: null };
  624    }
  625    let raw: unknown;
  626    try {
  627      raw = JSON.parse(step.argumentsJson);
  628    } catch {
  629      return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  630    }
  631    const args = Args.safeParse(raw);
  632    if (!args.success) {
  633      return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  634    }
  635    const parsed = action.input.safeParse(
  636      withKey(action, args.data, context.stepKey),
  637    );
  638    if (!parsed.success) {
  639      return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  640    }
  641  
  642    // Who it concerns: only people this grant covers.
  643    const relationshipId =
  644      typeof args.data["relationshipId"] === "string"
  645        ? args.data["relationshipId"]
  646        : null;
  647    const companyId =
  648      typeof args.data["companyId"] === "string" ? args.data["companyId"] : null;
  649    // Someone they said to leave out, named by id in any field: never.
  650    const excluded = new Set(
  651      context.grant.counterparts.exclude.map((entry) => entry.counterpartId),
  652    );
  653    const named = ["companyId", "investorOrganisationId"]
  654      .map((field) => args.data[field])
  655      .filter((value): value is string => typeof value === "string");
  656    const ofRelationship =
  657      relationshipId === null
  658        ? undefined
  659        : context.people.find(
  660            (person) => person.relationshipId === relationshipId,
  661          )?.counterpartId;
  662    if (
  663      named.some((id) => excluded.has(id)) ||
  664      (ofRelationship !== undefined && excluded.has(ofRelationship))
  665    ) {
  666      return { verdict: "REFUSED", code: "EXCLUDED", relationshipId };
  667    }
  668    const covered = inScope(context.grant, context.people);
  669    if (
  670      relationshipId !== null &&
  671      !covered.some((person) => person.relationshipId === relationshipId)
  672    ) {
  673      return { verdict: "REFUSED", code: "OUT_OF_SCOPE", relationshipId };
  674    }
  675    if (
  676      companyId !== null &&
  677      !covered.some(
  678        (person) =>
  679          person.counterpartKind === "COMPANY" &&
  680          person.counterpartId === companyId,
  681      )
  682    ) {
  683      return { verdict: "REFUSED", code: "OUT_OF_SCOPE", relationshipId };
  684    }
  685    const subject =
  686      relationshipId ??
  687      covered.find(
  688        (person) =>
  689          person.counterpartKind === "COMPANY" &&
  690          person.counterpartId === companyId,
  691      )?.relationshipId ??
  692      null;
  693  
  694    // Founder rule: nothing but interest before they accept -- not sent,
  695    // not offered as a card.
  696    if (
  697      NEEDS_CONNECTION.has(action.name) &&
  698      !connectedFor(context.people, subject)
  699    ) {
  700      return {
  701        verdict: "REFUSED",
  702        code: "NOT_CONNECTED_YET",
  703        relationshipId: subject,
  704      };
  705    }
  706  
  707    // What Q writes is checked before it is sent or asked (QA run 8a1d57b9):
  708    // a card with a generic message is no better than sending one.
  709    let factReply = false;
  710    if (action.name === "chat.message.send") {
  711      // Chat opens only once both sides agreed to connect (ADR 0019). A card
  712      // to someone who has not accepted is approved, then refused on send
  713      // (live seed: three approved cards failed APP_ACTION_REFUSED).
  714      const state =
  715        subject === null
  716          ? null
  717          : (context.people.find((person) => person.relationshipId === subject)
  718              ?.state ?? null);
  719      if (state !== null && !isMatchedRelationshipState(state)) {
  720        return {
  721          verdict: "REFUSED",
  722          code: "NOT_CONNECTED",
  723          relationshipId: subject,
  724        };
  725      }
  726      if (subject !== null && context.awaiting?.has(subject) === true) {
  727        return {
  728          verdict: "HOLD",
  729          code: "ALREADY_ASKED",
  730          relationshipId: subject,
  731          reason: "A message to them is already waiting for your yes.",
  732        };
  733      }
  734      const checked = messageProblem(parsed.data, subject, context, step);
  735      // Tensorgate, 8 Oct: Zino asked "Would you be open to connecting?" and
  736      // every reply proposing a call was refused (booking is ASK; delegation
  737      // was switched on 25 seconds later), so nothing reached the founder at
  738      // all. In a founder's reply to an investor, a proposed call is the
  739      // founder's card -- their yes, not silence. (The investor side keeps its
  740      // refusal and re-plan, unchanged.)
  741      if (
  742        checked.problem === "MEETING_NOT_ALLOWED" &&
  743        context.material?.sender.side === "COMPANY" &&
  744        subject !== null &&
  745        context.facts?.get(subject)?.lastFrom === "THEM" &&
  746        // Every other check still applies to the card's words.
  747        messageProblem(parsed.data, subject, context, step, true).problem === null
  748      ) {
  749        return {
  750          verdict: "ASK",
  751          action,
  752          input: parsed.data,
  753          relationshipId: subject,
  754          code: "MEETING_NEEDS_YES",
  755        };
  756      }
  757      if (checked.problem !== null) {
  758        return {
  759          verdict: "REFUSED",
  760          code: checked.problem,
  761          relationshipId: subject,
  762        };
  763      }
  764      factReply = checked.factReply;
  765    }
  766  
  767    // ADR 0050: consider the moment before any message, whatever the mode:
  768    // a held or softened step never reaches a card or the chat.
  769    let considered: OutreachConsideration = { decision: "PROCEED" };
  770    if (action.name === "chat.message.send") {
  771      considered = considerMessage(step, subject, context);
  772      if (considered.decision === "SOFTEN") {
  773        return {
  774          verdict: "REFUSED",
  775          code: considered.code,
  776          relationshipId: subject,
  777        };
  778      }
  779      if (considered.decision === "WAIT") {
  780        return {
  781          verdict: "HOLD",
  782          code: considered.code,
  783          relationshipId: subject,
  784          reason: considerationReason(considered, {
  785            lastFromUsAt:
  786              subject === null
  787                ? null
  788                : (context.pace?.get(subject)?.lastFromUsAt ?? null),
  789            timeZone: context.grant.workingHours.timeZone,
  790          }),
  791        };
  792      }
  793    }
  794    /** The consider step's hand-over, as the ASK reason code. */
  795    const ownerCode =
  796      considered.decision === "ASK_OWNER"
  797        ? considered.code === "AFTER_DECLINE"
  798          ? "THEY_DECLINED"
  799          : considered.code
  800        : null;
  801  
  802    const ask = (code: string): StepVerdict => ({
  803      verdict: "ASK",
  804      action,
  805      input: parsed.data,
  806      relationshipId: subject,
  807      code,
  808    });
  809    // A routine reply in a conversation under way goes on its own where the
  810    // grant says so; the AUTO checks below still apply to it in full.
  811    const routineReply =
  812      action.name === "chat.message.send" &&
  813      context.grant.routineReplies === true &&
  814      subject !== null &&
  815      // Replying to what they wrote (Spheros wrote first, after accepting):
  816      // their message is the conversation, so this is never a cold open.
  817      context.facts?.get(subject)?.lastFrom === "THEM";
  818    const delegated =
  819      granted.mode === "ASK" && delegatedStep(action, subject, context);
  820    if (granted.mode === "ASK" && !routineReply && !delegated) {
  821      return {
  822        verdict: "ASK",
  823        action,
  824        input: parsed.data,
  825        relationshipId: subject,
  826        code: ownerCode,
  827      };
  828    }
  829    // AUTO as granted -- but what Q may do alone is fixed in code.
  830    if (context.request === "PREPARE") return ask("ASKED_TO_PREPARE");
  831    if (ownerCode !== null) return ask(ownerCode);
  832    if (!delegableOnItsOwn(action)) return ask("NOT_DELEGABLE");
  833    // A declared cheque range or role, in code's own words, answering their
  834    // question about it, is a declared fact, not terms or a commitment (live
  835    // QA, ASK card f3e411b7): the planner's flag does not make it a card.
  836    if (step.touchesTermsOrMoney && !factReply) return ask("TERMS_OR_MONEY");
  837    // Code, not the planner, reads the thread's facts: where they raised
  838    // terms or money, or said no, Q does not act alone.
  839    const thread = subject === null ? undefined : context.facts?.get(subject);
  840    if (thread?.mentionsTermsOrMoney === true) return ask("THEY_RAISED_TERMS");
  841    if (thread?.declined === true) return ask("THEY_DECLINED");
  842    if (!withinWorkingHours(context.now, context.grant.workingHours)) {
  843      return {
  844        verdict: "REFUSED",
  845        code: "OUTSIDE_HOURS",
  846        relationshipId: subject,
  847      };
  848    }
  849    if (action.name === "chat.message.send") {
  850      const body = (parsed.data as { input?: { kind?: unknown } }).input;
  851      if (body?.kind !== "TEXT") return ask("ATTACHMENT");
  852      if (step.topic === null || !context.grant.topics.includes(step.topic)) {
  853        return ask("OFF_TOPIC");
  854      }
  855      const sent = subject === null ? 0 : (context.sent.get(subject) ?? 0);
  856      if (sent >= context.grant.maxMessagesPerCounterpart) {
  857        return ask("OVER_MESSAGE_CAP");
  858      }
  859      // ADR 0050: one message Q sends on its own per person per sitting; a
  860      // second in the same breath reads as a machine. (Cards are the
  861      // person's to send when they choose, so they are not held.)
  862      if (subject !== null && context.sitting !== undefined) {
  863        if ((context.sitting.get(subject) ?? 0) > 0) {
  864          const held: OutreachConsideration = {
  865            decision: "WAIT",
  866            code: "ONE_AT_A_TIME",
  867            until: null,
  868          };
  869          return {
  870            verdict: "HOLD",
  871            code: held.code,
  872            relationshipId: subject,
  873            reason: considerationReason(held),
  874          };
  875        }
  876        context.sitting.set(subject, 1);
  877      }
  878      if (subject !== null) context.sent.set(subject, sent + 1);
  879    }
  880    if (
  881      delegated &&
  882      action.name === "chat.message.send" &&
  883      subject !== null &&
  884      context.facts?.get(subject)?.lastFrom !== "THEM"
  885    ) {
  886      // A follow-up after silence: at most one per three of their working
  887      // days (the pacing above already holds five calendar days and stops
  888      // after two unanswered in a row).
  889      const lastFromUsAt = context.pace?.get(subject)?.lastFromUsAt ?? null;
  890      if (
  891        lastFromUsAt !== null &&
  892        workingDaysBetween(
  893          lastFromUsAt,
  894          context.now,
  895          context.grant.workingHours,
  896        ) < DELEGATION_LIMITS.followUpAfterWorkingDays
  897      ) {
  898        const held: OutreachConsideration = {
  899          decision: "WAIT",
  900          code: "TOO_SOON_TO_FOLLOW_UP",
  901          until: null,
  902        };
  903        return {
  904          verdict: "HOLD",
  905          code: held.code,
  906          relationshipId: subject,
  907          reason: considerationReason(held, {
  908            lastFromUsAt,
  909            timeZone: context.grant.workingHours.timeZone,
  910          }),
  911        };
  912      }
  913    }
  914    if (action.name === "schedule.meeting.book") {
  915      const meeting = (
  916        parsed.data as {
  917          input?: { startsAt?: unknown; durationMinutes?: unknown };
  918        }
  919      ).input;
  920      const startsAt =
  921        typeof meeting?.startsAt === "string" ? new Date(meeting.startsAt) : null;
  922      const minutes =
  923        typeof meeting?.durationMinutes === "number"
  924          ? meeting.durationMinutes
  925          : 0;
  926      if (
  927        startsAt === null ||
  928        Number.isNaN(startsAt.getTime()) ||
  929        !meetingWithinWorkingHours(startsAt, minutes, context.grant.workingHours)
  930      ) {
  931        return ask("MEETING_OUTSIDE_HOURS");
  932      }
  933    }
  934    if (delegated && context.delegation != null) {
  935      // The house daily cap on what Q does alone under delegation.
  936      const today = context.delegatedToday;
  937      if (today !== undefined) {
  938        if (today.count >= DELEGATION_LIMITS.sendsPerDay) {
  939          return ask("DELEGATION_DAILY_CAP");
  940        }
  941        today.count += 1;
  942      }
  943      return {
  944        verdict: "AUTO",
  945        action,
  946        input: parsed.data,
  947        relationshipId: subject,
  948        code: null,
  949        delegationId: context.delegation.id,
  950      };
  951    }
  952    return {
  953      verdict: "AUTO",
  954      action,
  955      input: parsed.data,
  956      relationshipId: subject,
  957      code: null,
  958    };
  959  }
  960  
  961  /**
  962   * ADR 0050: the consider step for one planned message. What kind of
  963   * message it is comes from the conversation itself (code's pace, else the
  964   * typed facts), never from the planner's own label.
  965   */
```
