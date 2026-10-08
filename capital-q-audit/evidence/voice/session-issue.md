# Evidence: apps/q-api/src/voice/routes.ts (lines 700-733)

- Original path: `apps/q-api/src/voice/routes.ts`
- Line range: 700-733 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Server opener when nothing else composed.

```ts
  700        // Continuing a conversation already on screen is not an arrival:
  701        // "Hi Zino. I'm listening" in the middle of one (founder live
  702        // 2026-09-29) read as Q forgetting what was just said. Q greets
  703        // only a new conversation.
  704        const continuing = input.conversationId !== undefined;
  705        if (
  706          firstMessage === undefined &&
  707          !resume &&
  708          !continuing &&
  709          input.rehearsal === undefined
  710        ) {
  711          // Q always speaks first. On the open thread there is no interview
  712          // state to open from, so the line is a plain greeting.
  713          const first = knownName?.trim().split(/\s+/)[0];
  714          const name = first !== undefined && first.length > 0 ? first : null;
  715          // Proactive (founder direction 2026-09-29): open with what is
  716          // theirs to deal with now, when it can be read quickly; the
  717          // plain greeting otherwise.
  718          const facts =
  719            dependencies.openerFacts === undefined
  720              ? null
  721              : await Promise.race([
  722                  dependencies.openerFacts(actor).catch(() => null),
  723                  new Promise<null>((resolve) =>
  724                    setTimeout(() => resolve(null), 1_200),
  725                  ),
  726                ]);
  727          firstMessage =
  728            facts !== null
  729              ? composeReturningOpener(name, facts, new Date())
  730              : name !== null
  731                ? `Hi ${name}. What's on your mind?`
  732                : "Hi. What's on your mind?";
  733        }
```

# Evidence: apps/q-api/src/voice/routes.ts (lines 799-931)

- Original path: `apps/q-api/src/voice/routes.ts`
- Line range: 799-931 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Binding issue, releaseFor(user), duplex offered on top of standard line.

```ts
  799        let credentials: {
  800          readonly token: string;
  801          readonly providerConversationId: string;
  802          readonly thinkToken?: string | undefined;
  803          readonly sessionToken: string;
  804          readonly settings?: DeepgramAgentSettings | undefined;
  805        };
  806        if (deepgram !== undefined) {
  807          // One voice session per person on this transport: a new one
  808          // replaces whatever was left open.
  809          dependencies.bindings.releaseFor(actor.userId);
  810          const providerConversationId = `dg_${voiceSessionId}`;
  811          const thinkToken = sealFor(providerConversationId, true);
  812          credentials = {
  813            token: await deepgram.mintToken(),
  814            providerConversationId,
  815            thinkToken,
  816            sessionToken: thinkToken,
  817            settings: deepgram.settingsFor({
  818              voice,
  819              greeting: firstMessage,
  820              thinkToken,
  821              ...(input.locale === undefined ? {} : { locale: input.locale }),
  822              // The organisation they typed at sign-up: the one name in this
  823              // conversation the recogniser could not know.
  824              terms: [
  825                ...(rehearsalName === null ? [] : [rehearsalName]),
  826                ...ownNames,
  827                ...(input.organisationHint === undefined
  828                  ? []
  829                  : [input.organisationHint]),
  830                ...rememberedTerms,
  831              ],
  832            }),
  833          };
  834        } else if (elevenLabs !== undefined) {
  835          const issued = await elevenLabs.createSession({ voice });
  836          credentials = {
  837            token: issued.token,
  838            providerConversationId: issued.providerConversationId,
  839            sessionToken: sealFor(issued.providerConversationId, false),
  840          };
  841        } else {
  842          throw new Error("unreachable: no voice transport");
  843        }
  844        const binding: VoiceSessionBinding = {
  845          voiceSessionId,
  846          providerConversationId: credentials.providerConversationId,
  847          actor,
  848          accessToken,
  849          voice,
  850          thread,
  851          issuedAt,
  852          connectBy: issuedAt + VOICE_CONNECT_WINDOW_MS,
  853          connectedAt: undefined,
  854          ...(credentials.thinkToken === undefined
  855            ? {}
  856            : { thinkToken: credentials.thinkToken }),
  857          ...(speakerVoiceId === undefined ? {} : { speakerVoiceId }),
  858          sessionToken: credentials.sessionToken,
  859        };
  860        const accepted = dependencies.bindings.issue(binding);
  861        if (!accepted) {
  862          throw new VoiceSessionLimitError();
  863        }
  864        started.add(1, { voice });
  865  
  866        // DUPLEX: offered on top of the standard line, never instead of it.
  867        // Any failure here is silent: the person gets the standard line.
  868        let duplex: QVoiceDuplexCredential | undefined;
  869        if (
  870          dependencies.duplex?.enabled === true &&
  871          input.duplex !== false &&
  872          input.rehearsal === undefined
  873        ) {
  874          try {
  875            const opened = await dependencies.duplex.open({
  876              binding,
  877              firstMessage,
  878              locale: input.locale,
  879              vocabulary: [
  880                ...ownNames,
  881                ...(input.organisationHint === undefined
  882                  ? []
  883                  : [input.organisationHint]),
  884                ...rememberedTerms,
  885              ],
  886            });
  887            if (opened.kind === "DUPLEX") {
  888              duplex = opened.credential;
  889              // The line is in use from now: kept past the connect window,
  890              // and the standard transport finds it connected on fallback.
  891              dependencies.bindings.connect(binding.providerConversationId);
  892            }
  893          } catch (error: unknown) {
  894            request.log.warn({ err: error }, "duplex voice unavailable");
  895          }
  896        }
  897  
  898        // Identifiers only: never the token, never the bearer.
  899        request.log.info(
  900          {
  901            qVoiceSessionId: voiceSessionId,
  902            voice,
  903            thread: input.onboarding === undefined ? "conversation" : "interview",
  904            resume,
  905            duplex: duplex !== undefined,
  906          },
  907          "voice session issued",
  908        );
  909        return reply
  910          .code(201)
  911          .header("Cache-Control", "no-store")
  912          .send(
  913            CreateQVoiceSessionResponseSchema.parse({
  914              voiceSessionId,
  915              providerConversationId: credentials.providerConversationId,
  916              token: credentials.token,
  917              voice,
  918              expiresAt: new Date(
  919                issuedAt + VOICE_CONNECT_WINDOW_MS,
  920              ).toISOString(),
  921              ...(firstMessage === undefined ? {} : { firstMessage }),
  922              sessionToken: credentials.sessionToken,
  923              provider:
  924                credentials.settings === undefined ? "elevenlabs" : "deepgram",
  925              ...(credentials.settings === undefined
  926                ? {}
  927                : { deepgram: credentials.settings }),
  928              ...(duplex === undefined ? {} : { duplex }),
  929            }),
  930          );
  931      },
```

