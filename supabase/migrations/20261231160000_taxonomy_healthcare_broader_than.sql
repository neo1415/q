-- Healthcare is broader than its product categories (live re-test 2026-10-29).
--
-- A founder who declared their sector as Telehealth (product_category) never
-- met an investor's Healthcare (industry): the two sat in different
-- vocabularies with no relation, so the fit read the sector as a mismatch.
-- Reference edges only: matching follows `broader_than` from a mandate's
-- node to the nodes under it (discovery taxonomy-expansion.ts). Nothing is
-- deleted or re-parented; no grant or RLS changes.
--
-- Rendered from @capital-q/taxonomy reference-data (stable v5 ids).

insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type) values
  ('e79290bb-1839-5433-b458-669edfd33f1e', 'b74391cc-44f2-5513-b3fa-96f7bbeb8139', 'broader_than'),
  ('e79290bb-1839-5433-b458-669edfd33f1e', '880a225e-e193-58c6-b925-0ea363967a10', 'broader_than')
on conflict (from_node_id, to_node_id, edge_type) do nothing;
