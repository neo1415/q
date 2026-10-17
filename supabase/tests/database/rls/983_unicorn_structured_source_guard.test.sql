-- Canonical claim revision UUIDs and permission-safe historical audit.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(18);
insert into core.companies(id,tenant_id,organisation_id,canonical_name,slug,current_stage_code,short_description,marketplace_visibility)
values('00000000-0000-4000-8000-000000009bc1',pg_temp.rls_id('tenant_a'),pg_temp.rls_id('org_a'),'Structured source proof','structured-source-proof','seed','Test','network_visible');
insert into evidence.claims(id,tenant_id,subject_type,subject_id,claim_type,claim_key,statement,structured_value,asserted_by_type,asserted_by_id,asserted_at,truth_class,evidence_status,lifecycle_status,visibility_scope,current_revision_id)
values('00000000-0000-4000-8000-000000009bc2',pg_temp.rls_id('tenant_a'),'COMPANY','00000000-0000-4000-8000-000000009bc1','test','unicorn.structured','Annual recurring revenue reached one million','{"value":1000000}','SYSTEM',pg_temp.rls_id('user_a'),'2026-10-17T00:00:00Z','USER_CLAIM','SELF_REPORTED','CURRENT','network_visible','00000000-0000-4000-8000-000000009bc3');
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id)
values('00000000-0000-4000-8000-000000009bc3',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',1,'Annual recurring revenue reached one million','{"value":1000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'));
create temp table unicorn_structured_candidate(value jsonb);
insert into unicorn_structured_candidate select jsonb_build_array(jsonb_build_object('company_id','00000000-0000-4000-8000-000000009bc1','revision',1,'assessed_at',clock_timestamp()+interval '1 second','observations',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('kind','CLAIM','id','00000000-0000-4000-8000-000000009bc2','revision','00000000-0000-4000-8000-000000009bc3','label','Annual recurring revenue reached one million','truthClass','USER_CLAIM','evidenceStatus','SELF_REPORTED','lifecycleStatus','CURRENT')))));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'canonical current revision UUID authorizes without timestamp cast');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"not-a-revision"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'malformed revision fails closed without cast exception');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"2026-99-99T00:00:00Z"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'invalid calendar date fails closed without cast exception');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"2026-10-17T00:00:00Z"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'legacy dated revision remains supported');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc3"');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',to_jsonb((clock_timestamp()-interval '1 day')::text));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'newer profile withholds stale current snapshot');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'profile touch does not erase authorized historical audit');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',to_jsonb((clock_timestamp()+interval '1 second')::text));
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id,change_reason)
values('00000000-0000-4000-8000-000000009bc4',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',2,'Annual recurring revenue reached two million','{"value":2000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'),'Corrected metric');
update evidence.claims set current_revision_id='00000000-0000-4000-8000-000000009bc4',current_revision_number=2,statement='Annual recurring revenue reached two million',structured_value='{"value":2000000}' where id='00000000-0000-4000-8000-000000009bc2';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'correction invalidates latest old revision');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'immutable public prior revision remains historically authorized');
update unicorn_structured_candidate set value=jsonb_set(jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc4"'),'{0,observations,0,source,label}','"Annual recurring revenue reached two million"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'corrected canonical UUID authorizes current source');
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id,change_reason,valid_to)
values('00000000-0000-4000-8000-000000009bc5',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',3,'Annual recurring revenue reached two million','{"value":2000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'),'Metric expired',(select updated_at + interval '1 microsecond' from knowledge.company_profiles where company_id='00000000-0000-4000-8000-000000009bc1'));
update evidence.claims set current_revision_id='00000000-0000-4000-8000-000000009bc5',current_revision_number=3,valid_to=(select valid_to from evidence.claim_revisions where id='00000000-0000-4000-8000-000000009bc5') where id='00000000-0000-4000-8000-000000009bc2';
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc5"');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',(select to_jsonb(updated_at::text) from knowledge.company_profiles where company_id='00000000-0000-4000-8000-000000009bc1'));
select ok((select (value->0->>'assessed_at')::timestamptz < q.valid_to and q.valid_to < clock_timestamp() from unicorn_structured_candidate cross join evidence.claims q where q.id='00000000-0000-4000-8000-000000009bc2'),'fixture snapshot precedes actual source expiry');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'valid_to expiry withholds current even when snapshot predates expiry');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'expired public source retains dated historical audit');
update evidence.claims set visibility_scope='founder_private' where id='00000000-0000-4000-8000-000000009bc2';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'privacy revocation withholds latest');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'privacy revocation also withholds history');
select ok(not has_function_privilege('authenticated','private.unicorn_potential_historical_revisions(jsonb)','execute'),'browser cannot invoke historical source oracle');
select ok(not has_function_privilege('anon','private.unicorn_potential_source_eligible_revisions(jsonb,boolean)','execute'),'anonymous cannot invoke common source oracle');
select ok(has_function_privilege('service_role','private.unicorn_potential_historical_revisions(jsonb)','execute'),'trusted service may reauthorize history');
update evidence.claims set visibility_scope='network_visible' where id='00000000-0000-4000-8000-000000009bc2';
update unicorn_structured_candidate set value=jsonb_set(value,'{0,company_id}',to_jsonb(pg_temp.rls_id('tenant_b')::text));
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'another canonical subject cannot reuse source lineage');
select * from finish();
rollback;
