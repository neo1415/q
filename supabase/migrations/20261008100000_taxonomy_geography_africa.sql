-- More of Africa in the geography vocabulary (CQ-ACCEPT-001).
--
-- An investor said "just Ghana and Côte d'Ivoire"; only Ghana could be
-- recorded, because West Africa held two countries (Nigeria, Ghana) and
-- East Africa one. A mandate naming a market Capital Q cannot place is a
-- mandate Capital Q silently narrows. This adds the countries investors in
-- these markets commonly name, each under its region, plus a Central
-- Africa region, with ISO 3166-1 alpha-2 metadata so declared geography fit
-- can match a company's headquarters (CQ-REC-GEO-001).
--
-- Rendered from @capital-q/taxonomy reference-data (geography v2): stable
-- v5 ids, additive only, nothing existing changes. The vocabulary version
-- moves to 2 (ADR 0005) so snapshots and slates that record a taxonomy
-- version can tell the vocabulary grew.

insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('9550fe4a-b69e-5c53-8b08-51b3ceb2c993', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'central_africa', 'Central Africa', null, '6d6366e0-bbb2-5a32-bad8-c747ca550c70', 1, 'ACTIVE', '{}'::jsonb),
  ('b2a2294f-e8e3-561e-80d6-ff1dc206a703', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'cote_divoire', 'Côte d''Ivoire', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"CI"}'::jsonb),
  ('6a5cc7f2-a629-56d7-a671-a198cd987cfc', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'senegal', 'Senegal', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"SN"}'::jsonb),
  ('eca21634-245c-5203-9268-26756327e600', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'benin', 'Benin', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"BJ"}'::jsonb),
  ('b0a4a8ba-d693-5230-a914-2e9fd57d686f', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'togo', 'Togo', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"TG"}'::jsonb),
  ('15ddfe6c-36ed-5226-95ea-71cc1fb4a8e1', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'rwanda', 'Rwanda', null, '0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', 2, 'ACTIVE', '{"iso3166Alpha2":"RW"}'::jsonb),
  ('df2d999f-60e3-5dd5-91c5-4ddc00e833cb', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'uganda', 'Uganda', null, '0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', 2, 'ACTIVE', '{"iso3166Alpha2":"UG"}'::jsonb),
  ('bde78451-b822-51ce-8b04-4c13747cff13', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'tanzania', 'Tanzania', null, '0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', 2, 'ACTIVE', '{"iso3166Alpha2":"TZ"}'::jsonb),
  ('a05ad0f4-5441-5c33-a2c5-2771898ceddb', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'ethiopia', 'Ethiopia', null, '0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', 2, 'ACTIVE', '{"iso3166Alpha2":"ET"}'::jsonb),
  ('776d3448-fc0e-51a6-8739-8dd91af0bb23', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'cameroon', 'Cameroon', null, '9550fe4a-b69e-5c53-8b08-51b3ceb2c993', 2, 'ACTIVE', '{"iso3166Alpha2":"CM"}'::jsonb),
  ('617903f1-c146-5357-abf3-e7071c5dfa85', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'dr_congo', 'Democratic Republic of the Congo', null, '9550fe4a-b69e-5c53-8b08-51b3ceb2c993', 2, 'ACTIVE', '{"iso3166Alpha2":"CD"}'::jsonb),
  ('9da455c0-d95c-5b2e-9bce-dc6fd1b0258a', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'zambia', 'Zambia', null, '8c932bde-ecea-5b7c-88b1-058e09a45fb5', 2, 'ACTIVE', '{"iso3166Alpha2":"ZM"}'::jsonb),
  ('a72c7fe6-76ee-50e1-bcd5-50edcba06f4d', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'botswana', 'Botswana', null, '8c932bde-ecea-5b7c-88b1-058e09a45fb5', 2, 'ACTIVE', '{"iso3166Alpha2":"BW"}'::jsonb),
  ('b83bac4c-6862-5c7b-a735-0e3736b191be', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'morocco', 'Morocco', null, '7e13b907-f267-5903-ac16-27910d44a0fb', 2, 'ACTIVE', '{"iso3166Alpha2":"MA"}'::jsonb),
  ('c1fbc2e1-3efe-5b29-bd70-4ff6614fedf3', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'tunisia', 'Tunisia', null, '7e13b907-f267-5903-ac16-27910d44a0fb', 2, 'ACTIVE', '{"iso3166Alpha2":"TN"}'::jsonb)
on conflict (id) do nothing;

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('59cc3b49-ee23-5e4b-9a40-3648c4f42a53', 'b2a2294f-e8e3-561e-80d6-ff1dc206a703', 'CI', 'en', 'ABBREVIATION', 'ci'),
  ('2d71e3b6-6e63-5f4e-8eec-c393e12630cd', 'b2a2294f-e8e3-561e-80d6-ff1dc206a703', 'Ivory Coast', 'en', 'SYNONYM', 'ivory coast'),
  ('c8157825-919e-5179-8206-5cc9e29cfd93', 'b2a2294f-e8e3-561e-80d6-ff1dc206a703', 'Cote d''Ivoire', 'en', 'SYNONYM', 'cote d''ivoire'),
  ('6a20a749-5c13-54c7-8893-c89293dacdab', 'b2a2294f-e8e3-561e-80d6-ff1dc206a703', 'Cote dIvoire', 'en', 'SYNONYM', 'cote divoire'),
  ('b2a52bac-d41e-5e50-810c-a2d63b2b9ade', '6a5cc7f2-a629-56d7-a671-a198cd987cfc', 'SN', 'en', 'ABBREVIATION', 'sn'),
  ('68f2a251-844c-5438-852c-9b0f2fed6720', 'eca21634-245c-5203-9268-26756327e600', 'BJ', 'en', 'ABBREVIATION', 'bj'),
  ('686284b1-d832-5f35-a94f-14fa9474926c', 'b0a4a8ba-d693-5230-a914-2e9fd57d686f', 'TG', 'en', 'ABBREVIATION', 'tg'),
  ('3018aa93-1b53-5607-994f-2d14c1d18b07', '15ddfe6c-36ed-5226-95ea-71cc1fb4a8e1', 'RW', 'en', 'ABBREVIATION', 'rw'),
  ('79648eb1-c874-54f8-8e5a-d505df2b243e', 'df2d999f-60e3-5dd5-91c5-4ddc00e833cb', 'UG', 'en', 'ABBREVIATION', 'ug'),
  ('47f6234f-7a7a-580b-ac54-e8adec330682', 'bde78451-b822-51ce-8b04-4c13747cff13', 'TZ', 'en', 'ABBREVIATION', 'tz'),
  ('c4495980-c92e-5a2c-83f9-f884624c841c', 'a05ad0f4-5441-5c33-a2c5-2771898ceddb', 'ET', 'en', 'ABBREVIATION', 'et'),
  ('334a7147-a407-52fb-97e0-899c5163d3ab', '776d3448-fc0e-51a6-8739-8dd91af0bb23', 'CM', 'en', 'ABBREVIATION', 'cm'),
  ('9b469368-3394-5cec-b684-5564be6f1e9b', '617903f1-c146-5357-abf3-e7071c5dfa85', 'CD', 'en', 'ABBREVIATION', 'cd'),
  ('1ca0f7d6-e02b-5fc8-912d-e6e5a5ba9aad', '617903f1-c146-5357-abf3-e7071c5dfa85', 'DRC', 'en', 'SYNONYM', 'drc'),
  ('380d36aa-2174-59cf-aeeb-0f6e12797bb6', '617903f1-c146-5357-abf3-e7071c5dfa85', 'DR Congo', 'en', 'SYNONYM', 'dr congo'),
  ('e4746638-68f8-5819-a42b-67effabdc0a3', '617903f1-c146-5357-abf3-e7071c5dfa85', 'Congo-Kinshasa', 'en', 'SYNONYM', 'congo-kinshasa'),
  ('b14bc5bf-2ca0-5713-9245-5a531d07b8c8', '9da455c0-d95c-5b2e-9bce-dc6fd1b0258a', 'ZM', 'en', 'ABBREVIATION', 'zm'),
  ('b8fc4d9c-f57d-586a-a5e4-70140f77252d', 'a72c7fe6-76ee-50e1-bcd5-50edcba06f4d', 'BW', 'en', 'ABBREVIATION', 'bw'),
  ('474e826f-6533-577c-9a1f-08a76a0dba23', 'b83bac4c-6862-5c7b-a735-0e3736b191be', 'MA', 'en', 'ABBREVIATION', 'ma'),
  ('8baeab0c-45ea-5b3f-95ac-89cb1df047fb', 'c1fbc2e1-3efe-5b29-bd70-4ff6614fedf3', 'TN', 'en', 'ABBREVIATION', 'tn')
on conflict (id) do nothing;

update taxonomy.vocabularies
   set version = 2
 where id = '512652ee-b4a7-519f-ae12-9db2b1607ee2'
   and version < 2;
