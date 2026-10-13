begin;
select plan(4);
select has_column('q_runtime', 'rehearsal_video_sessions', 'sealed_join_url', 'encrypted reconnect credential exists');
select ok((select relrowsecurity from pg_class where oid = 'q_runtime.rehearsal_video_sessions'::regclass), 'reconnect table retains RLS');
select ok(not has_column_privilege('authenticated', 'q_runtime.rehearsal_video_sessions', 'sealed_join_url', 'SELECT'), 'authenticated cannot read encrypted room credentials');
select ok(not has_column_privilege('anon', 'q_runtime.rehearsal_video_sessions', 'sealed_join_url', 'SELECT'), 'anon cannot read encrypted room credentials');
select * from finish();
rollback;
