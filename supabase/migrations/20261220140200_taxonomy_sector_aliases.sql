-- 2026-10-08 (F7) · sector words investors type that found no sector.
--
-- In the mandate's Sectors step (industry + product_category) "Climate",
-- "Climate tech" and "SaaS" found nothing useful: "climate tech" and
-- "saas" were aliases only of an impact theme and a business model, which
-- that step does not search. These are synonyms of existing industry
-- nodes; taxonomy values stay reference data (no enum), and an alias
-- never creates or renames a node. Nodes missing on a database (local)
-- are skipped; an alias already present is left as it is.

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias)
select gen_random_uuid(), n.id, a.alias, 'en', a.alias_type, a.normalized_alias
  from (values
    ('clean_energy',        'Climate tech',          'COLLOQUIAL', 'climate tech'),
    ('clean_energy',        'Climatetech',           'COLLOQUIAL', 'climatetech'),
    ('clean_energy',        'Climate',               'COLLOQUIAL', 'climate'),
    ('clean_energy',        'Clean tech',            'SYNONYM',    'clean tech'),
    ('clean_energy',        'Green tech',            'COLLOQUIAL', 'green tech'),
    ('clean_energy',        'Renewable energy',      'SYNONYM',    'renewable energy'),
    ('clean_energy',        'Renewables',            'SYNONYM',    'renewables'),
    ('enterprise_software', 'SaaS',                  'ABBREVIATION', 'saas'),
    ('enterprise_software', 'Software as a service', 'SYNONYM',    'software as a service'),
    ('enterprise_software', 'B2B SaaS',              'SYNONYM',    'b2b saas'),
    ('enterprise_software', 'Enterprise SaaS',       'SYNONYM',    'enterprise saas'),
    ('enterprise_software', 'Software',              'COLLOQUIAL', 'software')
  ) as a (canonical_code, alias, alias_type, normalized_alias)
  join taxonomy.nodes n on n.canonical_code = a.canonical_code
  join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'industry'
on conflict (node_id, locale, normalized_alias) do nothing;
