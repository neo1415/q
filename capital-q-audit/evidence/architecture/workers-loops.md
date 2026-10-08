# Excerpt: apps/workers/src/main.ts lines 1338-1455

- Original path: `apps/workers/src/main.ts`
- Line range: 1338-1455
- Why included: All worker loops composed in one Promise.all: outbox, pgmq consumers, documents, Gmail poller, schedule/notice/document/daily tickers, embeddings refresh, deck reading, auto-verification.

```
 1338  
 1339  // The loops hold the process resident; they return only after abort, at which
 1340  // point the pool is drained and telemetry flushed before exit.
 1341  await Promise.all([
 1342    runner.run(shutdownController.signal),
 1343    documentEvents.run(shutdownController.signal),
 1344    recommendationRefresh.run(shutdownController.signal),
 1345    ...(documents === undefined
 1346      ? []
 1347      : [documents.run(shutdownController.signal)]),
 1348    ...(gmailIntegrations.available
 1349      ? [
 1350          runGmailReplyPoller({
 1351            integrations: gmailIntegrations,
 1352            signal: shutdownController.signal,
 1353            logger,
 1354          }),
 1355        ]
 1356      : []),
 1357    runScheduleTicker({
 1358      schedule,
 1359      meetingMail,
 1360      signal: shutdownController.signal,
 1361      logger,
 1362    }),
 1363    runNoticeDeliveryTicker({
 1364      delivery: noticeDelivery,
 1365      signal: shutdownController.signal,
 1366      logger,
 1367    }),
 1368    runDocumentJobTicker({
 1369      runner: documentJobs,
 1370      signal: shutdownController.signal,
 1371      logger,
 1372    }),
 1373    // DAILY block
 1374    ...(daily === undefined
 1375      ? []
 1376      : [runDailyTicker({ daily, signal: shutdownController.signal, logger })]),
 1377    ...(recommendationEmbedder.missing.length > 0
 1378      ? []
 1379      : [
 1380          runCompanyEmbeddingRefresh({
 1381            semantic: recommendations.semantic,
 1382            logger,
 1383            limit: COMPANY_EMBEDDING_REFRESH_LIMIT,
 1384            intervalMs: 30 * 60 * 1000,
 1385            signal: shutdownController.signal,
 1386          }),
 1387        ]),
 1388    // Q.08: a ready deck unread after 10 minutes is an error line
 1389    // (alert DECK_READING_MISSING), only where decks can be read at all.
 1390    ...(deckReader === undefined
 1391      ? []
 1392      : [
 1393          // F26: the founder's "Read again" (two per deck version, held by the
 1394          // database), one a minute, at most 20 a day platform-wide.
 1395          runReadAgainLoop({
 1396            reading: {
 1397              sql: database.sql,
 1398              reader: deckReader,
 1399              store: createPostgresDataRoom(),
 1400              chunks: deckChunks,
 1401              logger,
 1402            },
 1403            queue: createPostgresDataRoom(),
 1404            intervalMs: 60 * 1000,
 1405            perSweep: 1,
 1406            dailyMax: 20,
 1407            signal: shutdownController.signal,
 1408          }),
 1409          // …and re-reads up to 10 of them per sweep (each once per process,
 1410          // at most $0.25 a sweep), so a missed reading heals itself.
 1411          runDeckReadingHeal({
 1412            sql: database.sql,
 1413            logger,
 1414            reading: {
 1415              sql: database.sql,
 1416              reader: deckReader,
 1417              store: createPostgresDataRoom(),
 1418              chunks: {
 1419                listActiveByVersion: (executor, tenantId, documentVersionId) =>
 1420                  createPostgresChunkRepository().listActiveByVersion(
 1421                    executor,
 1422                    tenantId as never,
 1423                    documentVersionId as never,
 1424                  ),
 1425              },
 1426              logger,
 1427            },
 1428            intervalMs: 15 * 60 * 1000,
 1429            perSweep: 10,
 1430            maxUsdPerSweep: 0.25,
 1431            signal: shutdownController.signal,
 1432          }),
 1433        ]),
 1434    // ADMIN-4 block
 1435    runAutoVerificationRequests({
 1436      sweep: autoVerificationSweep,
 1437      intervalMs: 10 * 60 * 1000,
 1438      signal: shutdownController.signal,
 1439      logger,
 1440    }),
 1441    // end ADMIN-4 block
 1442    ...(syntheticAutoVerifySweep === undefined
 1443      ? []
 1444      : [
 1445          runSyntheticAutoVerifySweeps({
 1446            sweep: syntheticAutoVerifySweep,
 1447            intervalMs: 10 * 60 * 1000,
 1448            signal: shutdownController.signal,
 1449            logger,
 1450          }),
 1451        ]),
 1452  ]);
 1453  await database.close();
 1454  await telemetry.shutdown();
 1455  logger.info({}, "worker runtime stopped");
```

