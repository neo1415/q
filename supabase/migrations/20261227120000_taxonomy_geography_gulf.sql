-- The Gulf in the geography vocabulary (2026-10-15).
--
-- Qatar had no node: a Doha founder or a Qatar-focused investor could not
-- name their own market, and Qatari investors' public profiles could not be
-- placed. This adds Qatar, Saudi Arabia, Kuwait, Bahrain and Oman under the
-- Middle East (the UAE was already there), each with ISO 3166-1 alpha-2
-- metadata so declared geography fit matches a company's headquarters.
--
-- Rendered from @capital-q/taxonomy reference-data (geography v3): stable v5
-- ids, additive only, nothing existing changes. The vocabulary version moves
-- to 3 (ADR 0005) so snapshots and slates can tell the vocabulary grew.

insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'qatar', 'Qatar', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"QA"}'::jsonb),
  ('d0145b00-c51b-5a03-ae2f-526a4169c8a3', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'saudi_arabia', 'Saudi Arabia', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"SA"}'::jsonb),
  ('3d04d1f9-22f4-58f8-8c07-f3f5fea82ff6', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'kuwait', 'Kuwait', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"KW"}'::jsonb),
  ('50e42308-e484-51b5-97d0-34a7cd3b0033', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'bahrain', 'Bahrain', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"BH"}'::jsonb),
  ('c3c5d0cf-4e01-5d2d-bfa9-6902ed35e6af', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'oman', 'Oman', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"OM"}'::jsonb)
on conflict (id) do nothing;

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('8f749923-24fa-53cf-bd0c-a6e79e6fc13f', 'ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3', 'QA', 'en', 'ABBREVIATION', 'qa'),
  ('8ac2025a-cb0b-51b2-84a3-74284d34d2a8', 'ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3', 'Doha', 'en', 'SYNONYM', 'doha'),
  ('bca2f379-4c98-5e5f-9aa1-29078f2043eb', 'd0145b00-c51b-5a03-ae2f-526a4169c8a3', 'SA', 'en', 'ABBREVIATION', 'sa'),
  ('fea438f5-3728-5fe5-b0a0-416432775d9b', 'd0145b00-c51b-5a03-ae2f-526a4169c8a3', 'KSA', 'en', 'SYNONYM', 'ksa'),
  ('e33997ac-1517-5ab6-bf0d-68f23ba5e875', 'd0145b00-c51b-5a03-ae2f-526a4169c8a3', 'Saudi', 'en', 'SYNONYM', 'saudi'),
  ('cef0b814-d243-5b68-a679-a3431002645b', '3d04d1f9-22f4-58f8-8c07-f3f5fea82ff6', 'KW', 'en', 'ABBREVIATION', 'kw'),
  ('1cdc22ef-5f04-574c-ac80-1be55c8e3a5c', '50e42308-e484-51b5-97d0-34a7cd3b0033', 'BH', 'en', 'ABBREVIATION', 'bh'),
  ('7e64228d-235f-5c3e-bb7c-d2f5007745a0', 'c3c5d0cf-4e01-5d2d-bfa9-6902ed35e6af', 'OM', 'en', 'ABBREVIATION', 'om')
on conflict (id) do nothing;

update taxonomy.vocabularies
   set version = 3
 where id = '512652ee-b4a7-519f-ae12-9db2b1607ee2'
   and version < 3;
