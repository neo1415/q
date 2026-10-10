-- Natural one-line descriptions for the Qatar Five (spoken as the card's
-- first sentence). Same text as scripts/seed/research/qatar-five.v1.json.
-- Data-only fix forward of 20261222093000; touches only profile.oneLine.

update q_runtime.external_persons
   set profile = jsonb_set(profile, '{oneLine}', to_jsonb('Doha-based finance and business-ventures executive who writes publicly about financial transparency and consumer purchasing power.'::text)), updated_at = now()
 where tenant_id is null and profile_key = 'qa-demo-shadi-qishta';

update q_runtime.external_persons
   set profile = jsonb_set(profile, '{oneLine}', to_jsonb('Qatar-based Islamic investment group spanning investment banking, principal investments and asset management.'::text)), updated_at = now()
 where tenant_id is null and profile_key = 'qa-demo-qinvest';

update q_runtime.external_persons
   set profile = jsonb_set(profile, '{oneLine}', to_jsonb('Alchemist Doha's Director of Investments, backing early-stage tech startups as they reach investors and scale.'::text)), updated_at = now()
 where tenant_id is null and profile_key = 'qa-demo-muhannad-taslaq';

update q_runtime.external_persons
   set profile = jsonb_set(profile, '{oneLine}', to_jsonb('Qatar''s national investment promotion agency, helping companies enter and grow in Qatar; not a venture fund.'::text)), updated_at = now()
 where tenant_id is null and profile_key = 'qa-demo-invest-qatar';

update q_runtime.external_persons
   set profile = jsonb_set(profile, '{oneLine}', to_jsonb('Qatar investment and advisory firm owned by AlRayan Bank, covering asset management, sukuk and M&A advisory.'::text)), updated_at = now()
 where tenant_id is null and profile_key = 'qa-demo-alrayan';
