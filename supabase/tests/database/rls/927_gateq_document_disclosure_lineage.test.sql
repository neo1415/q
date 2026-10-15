begin;
create extension if not exists pgtap;
select plan(11);
select has_column('gateq','application_facts','disclosure_lineage','facts retain exact dependency lineage');
select has_column('gateq','application_turns','disclosure_lineage','Q replies retain transitive dependency lineage');
select ok(gateq.check_disclosure_lineage(null,null,null,null),'historical null remains unknown without fabricated metadata');
select ok(gateq.check_disclosure_lineage('{"state":"UNKNOWN"}',null,null,null),'explicit unknown accepted as debt');
select ok(gateq.check_disclosure_lineage('{"state":"COMPLETE","documents":[],"turnSeqs":[]}',null,null,null),'explicit text-only complete shape accepted');
select ok(not gateq.check_disclosure_lineage('{"state":"COMPLETE","documents":[],"turnSeqs":[99]}',null,null,null),'dangling context turn refused');
select ok(not gateq.check_disclosure_lineage('{"state":"COMPLETE","documents":[{"documentId":"11111111-1111-4111-8111-111111111111","versionId":"22222222-2222-4222-8222-222222222222","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"turnSeqs":[]}',null,null,null),'unowned document identity refused');
select ok(not has_function_privilege('authenticated','gateq.check_disclosure_lineage(jsonb,uuid,uuid,integer)','EXECUTE'),'lineage validator has no browser grant');
select has_trigger('gateq','application_facts','application_facts_disclosure_lineage_valid','fact lineage is validated on write');
select has_trigger('gateq','application_turns','application_turns_disclosure_lineage_valid','turn lineage is validated on write');
select ok(not exists(select 1 from pg_constraint where conname in ('application_facts_disclosure_lineage_valid','application_turns_disclosure_lineage_valid') and contype='c'),
  'no cross-table CHECK constraint that a logical restore would evaluate before its referenced rows exist');
select * from finish();
rollback;
