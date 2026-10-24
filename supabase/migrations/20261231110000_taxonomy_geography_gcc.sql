-- The Gulf (GCC) region in the geography vocabulary (QA F-81, 2026-10-24).
--
-- "Egypt, Morocco and the Gulf" saved Egypt and Morocco only: nothing named
-- the Gulf, so the phrase stayed in the person's words and the region never
-- reached their mandate. This adds a "Gulf (GCC)" region under the Middle
-- East and re-parents the six GCC countries under it (same ids, nothing
-- deleted). The Middle East still contains all six through the region, so a
-- mandate or a filter on the Middle East matches exactly what it did; "the
-- Gulf", "Gulf states", "GCC" and "Arabian Gulf" now name the region.
--
-- Rendered from @capital-q/taxonomy reference-data (geography v4): stable v5
-- ids. The vocabulary version moves to 4 (ADR 0005). Revision note: the six
-- countries' parent_node_id and depth change; their ids, codes, names,
-- metadata, aliases and every company/mandate assignment to them stay.

insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('e7020c85-8cfc-56fc-8250-ff4be3af6512', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'gcc', 'Gulf (GCC)', 'The Gulf Cooperation Council countries.', '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{}'::jsonb)
on conflict (id) do nothing;

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('171e5fb9-2866-56f0-9ce6-004c7b55841c', 'e7020c85-8cfc-56fc-8250-ff4be3af6512', 'the Gulf', 'en', 'SYNONYM', 'the gulf'),
  ('2923be48-d790-5b90-a6a4-068e9e9d81ee', 'e7020c85-8cfc-56fc-8250-ff4be3af6512', 'Gulf', 'en', 'SYNONYM', 'gulf'),
  ('321b9a4a-f247-5dc6-8554-c7e382cd5969', 'e7020c85-8cfc-56fc-8250-ff4be3af6512', 'Gulf states', 'en', 'SYNONYM', 'gulf states'),
  ('07c9b9fa-76ba-53d6-aae2-44c0499d0d16', 'e7020c85-8cfc-56fc-8250-ff4be3af6512', 'Arabian Gulf', 'en', 'SYNONYM', 'arabian gulf'),
  ('4dce12b3-a80d-5e41-addb-a350c76002b9', 'e7020c85-8cfc-56fc-8250-ff4be3af6512', 'GCC', 'en', 'ABBREVIATION', 'gcc')
on conflict (id) do nothing;

-- Parent and depth together, as the hierarchy trigger checks them as a pair.
update taxonomy.nodes
   set parent_node_id = 'e7020c85-8cfc-56fc-8250-ff4be3af6512', depth = 2
 where id in (
         '2593e271-7b16-575d-8650-5e35054df867', -- united_arab_emirates
         'ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3', -- qatar
         'd0145b00-c51b-5a03-ae2f-526a4169c8a3', -- saudi_arabia
         '3d04d1f9-22f4-58f8-8c07-f3f5fea82ff6', -- kuwait
         '50e42308-e484-51b5-97d0-34a7cd3b0033', -- bahrain
         'c3c5d0cf-4e01-5d2d-bfa9-6902ed35e6af'  -- oman
       )
   and parent_node_id = '844584db-20ed-5274-973c-4c23e55e61d1';

update taxonomy.vocabularies
   set version = 4
 where id = '512652ee-b4a7-519f-ae12-9db2b1607ee2'
   and version < 4;

-- Companies headquartered in the Gulf carry their country's ancestors in the
-- knowledge projection; refreshed now so "gcc" is among them at once.
do $$
declare
  target uuid;
begin
  for target in
    select c.id from core.companies c
     where c.headquarters_country in ('AE', 'SA', 'QA', 'KW', 'BH', 'OM')
  loop
    perform knowledge.refresh_company_profile(target);
  end loop;
end;
$$;
