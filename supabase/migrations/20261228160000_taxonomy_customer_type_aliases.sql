-- 2026-10-16 (ob2, live check 4 on release AB) · customer words investors
-- write in a fund deck that found no customer type.
--
-- "SMEs" did not reach Small & Medium Business: the alias was "sme" only,
-- matching is by whole token, and "sme" is too short for the similarity
-- path. These are synonyms of existing customer_type nodes; taxonomy
-- values stay reference data (no enum), and an alias never creates or
-- renames a node. Nodes missing on a database (local) are skipped; an
-- alias already present is left as it is. normalized_alias follows
-- normalizeTaxonomyAlias (lowercase, single spaces, no spaces around "-").

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias)
select gen_random_uuid(), n.id, a.alias, 'en', a.alias_type, a.normalized_alias
  from (values
    ('small_business', 'SME',                            'ABBREVIATION', 'sme'),
    ('small_business', 'SMEs',                           'ABBREVIATION', 'smes'),
    ('small_business', 'SMBs',                           'ABBREVIATION', 'smbs'),
    ('small_business', 'MSME',                           'ABBREVIATION', 'msme'),
    ('small_business', 'MSMEs',                          'ABBREVIATION', 'msmes'),
    ('small_business', 'Small businesses',               'SYNONYM',      'small businesses'),
    ('small_business', 'Small business',                 'SYNONYM',      'small business'),
    ('small_business', 'Small and medium enterprises',   'SYNONYM',      'small and medium enterprises'),
    ('small_business', 'Small and medium-sized enterprises', 'SYNONYM',  'small and medium-sized enterprises'),
    ('small_business', 'Small and medium businesses',    'SYNONYM',      'small and medium businesses'),
    ('mid_market',     'Mid-market',                     'SYNONYM',      'mid-market'),
    ('mid_market',     'Mid market',                     'SYNONYM',      'mid market'),
    ('mid_market',     'Midmarket',                      'SYNONYM',      'midmarket'),
    ('mid_market',     'Mid-sized companies',            'SYNONYM',      'mid-sized companies'),
    ('mid_market',     'Mid-sized businesses',           'SYNONYM',      'mid-sized businesses'),
    ('enterprise',     'Enterprise',                     'SYNONYM',      'enterprise'),
    ('enterprise',     'Enterprises',                    'SYNONYM',      'enterprises'),
    ('enterprise',     'Large companies',                'SYNONYM',      'large companies'),
    ('enterprise',     'Corporates',                     'COLLOQUIAL',   'corporates'),
    ('consumer',       'Consumers',                      'SYNONYM',      'consumers'),
    ('consumer',       'B2C',                            'ABBREVIATION', 'b2c'),
    ('consumer',       'Retail consumers',               'SYNONYM',      'retail consumers'),
    ('consumer',       'Households',                     'COLLOQUIAL',   'households'),
    ('government',     'Government',                     'SYNONYM',      'government'),
    ('government',     'Governments',                    'SYNONYM',      'governments'),
    ('government',     'Public sector',                  'SYNONYM',      'public sector'),
    ('government',     'Public institutions',            'SYNONYM',      'public institutions')
  ) as a (canonical_code, alias, alias_type, normalized_alias)
  join taxonomy.nodes n on n.canonical_code = a.canonical_code
  join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'customer_type'
on conflict (node_id, locale, normalized_alias) do nothing;
