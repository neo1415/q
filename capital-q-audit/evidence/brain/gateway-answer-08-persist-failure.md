# Evidence: packages/model-gateway/src/q/index.ts (lines 4150-4340)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 4150-4340 (HEAD 9177629d)
- Why included: Persist answer, observation/telemetry, failure salvage for INVALID_MODEL_OUTPUT.

```ts
 4150          const reply =
 4151            revisedArtifact === null
 4152              ? answerText.length > 0
 4153                ? answerText
 4154                : openedOnScreen
 4155                  ? CLIENT_ACTION_DONE_LINE
 4156                  : "Understood."
 4157              : `${content}
 4158
 4159  I've updated **${revisedArtifact.title}** — that's version ${String(revisedArtifact.currentVersion)}. The previous version is still there, and nothing has been shared or sent.`.trim();
 4160          const message = await persistAnswer(
 4161            reply,
 4162            revisedArtifact === null
 4163              ? analystBlocks
 4164              : [
 4165                  ...(analystBlocks ?? []),
 4166                  {
 4167                    kind: "ARTIFACT_REFERENCE" as const,
 4168                    artifactId: revisedArtifact.artifactId,
 4169                    type: revisedArtifact.type,
 4170                    status: revisedArtifact.status,
 4171                    title: revisedArtifact.title,
 4172                  },
 4173                ],
 4174            gesturesForReply(reply, analyst.gestures),
 4175          );
 4176          last = {
 4177            result: analyst,
 4178            providerCode: final.providerCode,
 4179            modelCode: final.modelCode,
 4180            promptBundleVersion: rendered.bundle.bundleVersion,
 4181            routingPolicyCode: final.routingPolicyCode,
 4182            latencyMs: final.latencyMs,
 4183            usage: {
 4184              inputTokens: final.usage.inputTokens,
 4185              outputTokens: final.usage.outputTokens,
 4186            },
 4187            costUsd: final.cost.amount,
 4188            promptCharacters: rendered.characters,
 4189            toolsOffered: offered.map((tool) => tool.definition.name),
 4190            toolCalls,
 4191            modelCalls,
 4192          };
 4193          logger?.info(
 4194            {
 4195              qRunId: request.runId,
 4196              taskClass,
 4197              promptBundleVersion: rendered.bundle.bundleVersion,
 4198              promptCharacters: rendered.characters,
 4199              provider: final.providerCode,
 4200              model: final.modelCode,
 4201              routingPolicy: final.routingPolicyCode,
 4202              responseShape: analyst.responseShape,
 4203              insufficientEvidence: analyst.insufficientEvidence,
 4204              attempts: final.attempts.length,
 4205              fallbackUsed: final.fallbackUsed,
 4206              latencyMs: final.latencyMs,
 4207              costUsd: final.cost.amount,
 4208              toolsOffered: offered.length,
 4209              toolCalls: toolCalls.length,
 4210              modelCalls,
 4211              totalMs: Date.now() - startedAt,
 4212              phases,
 4213              // How much of the answer the person already had before the
 4214              // turn finished. Zero means nobody was listening, or the
 4215              // model wrote its object in an order this cannot read.
 4216              streamedCharacters: streamedText.length,
 4217              firstPublishedMs,
 4218            },
 4219            "q answer produced",
 4220          );
 4221          if (nudgeOffered && dependencies.onboardingNudge !== undefined) {
 4222            // After the answer, never before: a failed answer offered nothing.
 4223            await dependencies.onboardingNudge
 4224              .markShown(request.actor, conversationId)
 4225              .catch((error: unknown) => {
 4226                logger?.warn(
 4227                  { err: error, qRunId: request.runId },
 4228                  "the setup reminder was not recorded as given",
 4229                );
 4230              });
 4231          }
 4232          return {
 4233            kind: "ANSWERED",
 4234            messageId: message.id,
 4235            modelPolicyVersion: final.routingPolicyCode,
 4236            promptBundleVersion: rendered.bundle.bundleVersion,
 4237          };
 4238        } catch (error: unknown) {
 4239          if (isModelGatewayError(error)) {
 4240            /**
 4241             * The answer was heard; the object around it was refused.
 4242             *
 4243             * Live, a person asked about their company, Q read the answer
 4244             * out sentence by sentence, and then said it had hit a snag and
 4245             * asked them to ask again. The final object had failed its
 4246             * schema on a label in a citation list, a field the person never
 4247             * sees. Nothing said can be unsaid, and an answer that was
 4248             * delivered is not a failure: the prose that was read to them
 4249             * stands as the answer, through the same guards as any other,
 4250             * and the structured extras the schema refused are simply not
 4251             * recorded for this turn. Only the prose the reader saw with
 4252             * certainty is used: the whole answer when its closing quote was
 4253             * seen, otherwise the sentences that were actually published.
 4254             */
 4255            if (error.failureClass === "INVALID_MODEL_OUTPUT") {
 4256              const heard = partial.complete() ? seenAnswer : streamedText;
 4257              /**
 4258               * The structure was refused, so whatever the person asked Q
 4259               * to change was not handed to anybody (CQ-QX-007 A5). Nothing
 4260               * may then read as if it had been: the sentences the model
 4261               * itself marked as talk about acting are removed, and when its
 4262               * own reading carried a change, Capital Q says plainly that
 4263               * nothing was changed. Read from the model's structured fields
 4264               * where they parse, never from its words.
 4265               */
 4266              const unread = unreadActionOf(seenText);
 4267              const salvaged = withoutRecommendationClaims(
 4268                citeAuthorisedFacts(
 4269                  withoutPublicSourceLabels(
 4270                    stripEmptyPromises(
 4271                      withoutActionTalk(heard, unread.actionTalk).text,
 4272                    ).text,
 4273                    publicSources,
 4274                  ),
 4275                  facts,
 4276                ),
 4277                recommendationGrounds,
 4278              )
 4279                .text.concat(
 4280                  unread.requested ? `\n\n${UNPREPARED_CHANGE_LINE}` : "",
 4281                )
 4282                .slice(0, ANSWER_LIMIT_CHARS)
 4283                .trim();
 4284              // Founder live 2026-09-30: open_page opened the chat, then the
 4285              // model's closing words came back empty and the whole turn
 4286              // failed, so the screen never moved. What a tool already did
 4287              // for them stands: it is said in a few plain words.
 4288              const spoken =
 4289                salvaged.length > 0
 4290                  ? salvaged
 4291                  : clientActionBlocks.length > 0
 4292                    ? CLIENT_ACTION_DONE_LINE
 4293                    : "";
 4294              if (spoken.length > 0) {
 4295                const message = await persistAnswer(spoken);
 4296                logger?.warn(
 4297                  {
 4298                    qRunId: request.runId,
 4299                    taskClass,
 4300                    promptBundleVersion: rendered.bundle.bundleVersion,
 4301                    routingPolicy: error.routingPolicyCode,
 4302                    answerComplete: partial.complete(),
 4303                    streamedCharacters: streamedText.length,
 4304                    answerCharacters: spoken.length,
 4305                    toolCalls: toolCalls.length,
 4306                    modelCalls,
 4307                  },
 4308                  "the answer's structure was refused after its text had been read; the text stands as the answer",
 4309                );
 4310                return {
 4311                  kind: "ANSWERED",
 4312                  messageId: message.id,
 4313                  modelPolicyVersion: error.routingPolicyCode ?? "unrouted",
 4314                  promptBundleVersion: rendered.bundle.bundleVersion,
 4315                };
 4316              }
 4317            }
 4318            logger?.warn(
 4319              {
 4320                qRunId: request.runId,
 4321                taskClass,
 4322                promptBundleVersion: rendered.bundle.bundleVersion,
 4323                failureClass: error.failureClass,
 4324                attempts: error.attempts,
 4325                routingPolicy: error.routingPolicyCode,
 4326                toolCalls: toolCalls.length,
 4327                modelCalls,
 4328              },
 4329              "q answer not produced",
 4330            );
 4331            return {
 4332              kind: "FAILED",
 4333              diagnosticCode: diagnosticCodeFor(error.failureClass),
 4334            };
 4335          }
 4336          throw error;
 4337        }
 4338      },
 4339    };
 4340  }
```
