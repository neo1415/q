# Evidence: apps/q-api/src/composition/errands.ts lines 1340-1460

- Original path: `apps/q-api/src/composition/errands.ts`
- Line range: 1340-1460 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Errand reply: send failure still recorded as 'Q answered' and repliesSent+1.

```ts
 1340            plan.data,
 1341            link,
 1342            fresh
 1343              .map((message) => message.text ?? "")
 1344              .join("\n")
 1345              .slice(0, 6_000),
 1346            dependencies.negotiation,
 1347          ))
 1348        ) {
 1349          await update(row.id, { seenUntil: newest });
 1350          return;
 1351        }
 1352        const brief = plan.data.brief;
 1353        if (brief !== null && current.replies_sent < MAX_REPLIES) {
 1354          const principalName =
 1355            (await dependencies.nameOf(row.user_id)) ?? "the person";
 1356          const thread = read.messages
 1357            .slice(-20)
 1358            .map(
 1359              (message) =>
 1360                `${message.from === "OTHER_SIDE" ? message.senderName : `${message.senderName} (${principalName}'s side)`}: ${message.text ?? `[${message.attachmentTitle ?? message.kind}]`}`,
 1361            )
 1362            .join("\n");
 1363          const passedBox: { verdict: OutwardVerdict | null } = {
 1364            verdict: null,
 1365          };
 1366          const errandSource = {
 1367            kind: "ERRAND",
 1368            id: row.id,
 1369            goal: `Look after ${row.counterpart_name}`,
 1370          } as const;
 1371          // Filed first, so the writer's own call is priced under the job (J6).
 1372          const prepared =
 1373            (await dependencies.review
 1374              ?.prepare(actor, errandSource, {
 1375                channel: "CHAT",
 1376                counterpartName: row.counterpart_name,
 1377              })
 1378              .catch(() => null)) ?? null;
 1379          const answer = await reviewedReply(
 1380            dependencies.review,
 1381            actor,
 1382            errandSource,
 1383            {
 1384              principalName,
 1385              counterpartName: row.counterpart_name,
 1386              channel: "CHAT",
 1387              stage: "REPLY",
 1388              purpose:
 1389                "Answer what the other side last asked or said, using only the approved brief.",
 1390              material: brief,
 1391              thread,
 1392              // Code's thread-consistency check reads what they just wrote.
 1393              theirLatest: fresh
 1394                .map((message) => message.text ?? "")
 1395                .join("\n")
 1396                .slice(0, 4_000),
 1397            },
 1398            await composer.compose({
 1399              actor,
 1400              principalName,
 1401              counterpartName: row.counterpart_name,
 1402              brief,
 1403              callComing:
 1404                plan.data.bookCall !== null && current.meeting_id === null,
 1405              thread,
 1406              ...(prepared === null
 1407                ? {}
 1408                : { correlationId: prepared.correlationId }),
 1409            }),
 1410            (verdict) => {
 1411              passedBox.verdict = verdict;
 1412            },
 1413            prepared,
 1414          );
 1415          const passed = passedBox.verdict;
 1416          if (answer?.reply != null) {
 1417            const sent = await post(
 1418              actor,
 1419              row,
 1420              `reply:${newest.toISOString()}`,
 1421              answer.reply,
 1422            ).catch(() => false);
 1423            // The graded draft really went: its outcome is "sent" (J5).
 1424            if (sent && passed !== null) {
 1425              await dependencies.review
 1426                ?.settle(actor, passed, "SENT")
 1427                .catch(() => undefined);
 1428            }
 1429          }
 1430          await update(row.id, {
 1431            seenUntil: newest,
 1432            repliesSent: current.replies_sent + (answer?.reply == null ? 0 : 1),
 1433            lastStep:
 1434              answer?.reply == null
 1435                ? `${row.counterpart_name} wrote.`
 1436                : `Q answered ${row.counterpart_name}.`,
 1437          });
 1438          if (answer !== null && answer.forPerson.length > 0) {
 1439            await tell(
 1440              row,
 1441              link,
 1442              `ask:${newest.toISOString()}`,
 1443              `${row.counterpart_name} asked something only you can answer`,
 1444              answer.forPerson.join("\n"),
 1445            );
 1446          }
 1447        } else {
 1448          await update(row.id, {
 1449            seenUntil: newest,
 1450            lastStep: `${row.counterpart_name} wrote.`,
 1451          });
 1452          await tell(
 1453            row,
 1454            link,
 1455            `wrote:${newest.toISOString()}`,
 1456            `${row.counterpart_name} wrote to you`,
 1457            fresh.at(-1)?.text ?? null,
 1458          );
 1459        }
 1460      }
```
