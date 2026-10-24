-- The red-flag industries in the industry vocabulary (QO-28b, 2026-10-24).
--
-- An investor could say "never show me gambling" and Discover could not act
-- on it: no company could be gambling, because no node existed to declare.
-- This adds five industry nodes whose canonical codes are the red-flag codes
-- the investor journey records: gambling, tobacco, weapons, adult_content,
-- crypto_speculation. Companies declare them like any other sector; only a
-- declared classification excludes, and a company that has declared no
-- industry stays unknown and is never excluded (ADR 0020).
--
-- Rendered from @capital-q/taxonomy reference-data (industry v2): stable v5
-- ids, additive only, nothing existing changes. The vocabulary version moves
-- to 2 (ADR 0005) so snapshots and slates can tell the vocabulary grew.

insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('69419580-1247-540b-810e-1ae3360f55c9', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'gambling', 'Gambling & Betting', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('31522f76-8a35-5400-8cb3-856ab856e6cf', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'tobacco', 'Tobacco & Nicotine', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b05114c2-f67f-5f2e-9f10-6ac44587b601', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'weapons', 'Weapons & Firearms', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('525fe599-0222-5edf-9cbb-1521bc81a81b', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'adult_content', 'Adult Content', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('6d96800a-bb5f-5d47-a9fc-759cbcbaa5b8', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'crypto_speculation', 'Speculative Crypto', 'Token speculation and trading-led crypto products.', null, 0, 'ACTIVE', '{}'::jsonb)
on conflict (id) do nothing;

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('c426a83c-20f1-512c-bb79-989d3a6e3014', '69419580-1247-540b-810e-1ae3360f55c9', 'betting', 'en', 'SYNONYM', 'betting'),
  ('39087ffb-ae0d-511f-b420-f1ab67f38c7d', '69419580-1247-540b-810e-1ae3360f55c9', 'sports betting', 'en', 'SYNONYM', 'sports betting'),
  ('16268cc2-5bda-504c-a519-eb24e28959d4', '69419580-1247-540b-810e-1ae3360f55c9', 'casino', 'en', 'SYNONYM', 'casino'),
  ('d85ee78c-8d12-5ccf-ad47-7b1e6866dcc3', '69419580-1247-540b-810e-1ae3360f55c9', 'igaming', 'en', 'SYNONYM', 'igaming'),
  ('5255a039-c38c-5c05-8a0f-19a41e5a3c46', '31522f76-8a35-5400-8cb3-856ab856e6cf', 'vaping', 'en', 'SYNONYM', 'vaping'),
  ('1e211b26-efb1-5277-bd42-b59d1510b351', '31522f76-8a35-5400-8cb3-856ab856e6cf', 'e-cigarettes', 'en', 'SYNONYM', 'e-cigarettes'),
  ('d6f19c20-e747-5b18-bb4b-eb51a7be76ad', '31522f76-8a35-5400-8cb3-856ab856e6cf', 'nicotine products', 'en', 'SYNONYM', 'nicotine products'),
  ('f8dd936a-314b-53b3-8632-a85cb8c49ca8', 'b05114c2-f67f-5f2e-9f10-6ac44587b601', 'firearms', 'en', 'SYNONYM', 'firearms'),
  ('9fbfa236-740d-54e0-b4a5-b47a045a9538', 'b05114c2-f67f-5f2e-9f10-6ac44587b601', 'munitions', 'en', 'SYNONYM', 'munitions'),
  ('6a93ce99-1cee-5613-8494-87998d741168', '525fe599-0222-5edf-9cbb-1521bc81a81b', 'adult entertainment', 'en', 'SYNONYM', 'adult entertainment'),
  ('60b7351f-c8a3-5d31-961f-7c3590dbf296', '6d96800a-bb5f-5d47-a9fc-759cbcbaa5b8', 'memecoins', 'en', 'SYNONYM', 'memecoins'),
  ('b257c98f-1778-5a1c-b2a9-8ae5bfec997c', '6d96800a-bb5f-5d47-a9fc-759cbcbaa5b8', 'token speculation', 'en', 'SYNONYM', 'token speculation')
on conflict (id) do nothing;

update taxonomy.vocabularies
   set version = 2
 where id = '9e323247-8a4b-575b-acdc-6f682f0d6a7b'
   and version < 2;
