-- Off-topic "Q found something new" notices (lead 2026-10-03, demo pass):
-- the scout producer had no relevance gate (fixed in harden-46, scoutRelevance),
-- so stored Q_SCOUT notices include unrelated pages (another language, a
-- namesake product). Fix forward: mark the unread ones read so they stop
-- asking for attention. Rows are kept (no history is deleted); new notices
-- pass the gate.

update communication.notifications
   set read_at = now()
 where kind = 'Q_SCOUT'
   and read_at is null;
