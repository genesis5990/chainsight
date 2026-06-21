-- ChainSight v1.1 §6.3 — Pathfinder materialized graph store
--
-- belief.case_subgraph_nodes + belief.case_subgraph_edges are denormalized
-- views of BeliefAtoms with structural predicates (tx_exists, address_sent,
-- address_received). The graph materializer worker upserts rows here;
-- the Pathfinder reads them into an in-process adjacency cache.

CREATE TABLE IF NOT EXISTS belief.case_subgraph_edges (
  id                  uuid PRIMARY KEY DEFAULT belief.gen_uuid_v7(),
  case_id             uuid NOT NULL,
  chain               text NOT NULL,
  from_subject        text NOT NULL,
  to_subject          text NOT NULL,
  edge_kind           text NOT NULL,                  -- 'tx_native' | 'tx_token' | 'internal' | 'bridge_hop'
  tx_ref              text NOT NULL,
  edge_index          int  NOT NULL DEFAULT 0,
  block_height        bigint NOT NULL,
  block_time          timestamptz NOT NULL,
  value_minor         numeric(80, 0) NOT NULL,
  obfuscation_marker  text,                           -- 'mixer' | 'peel' | NULL
  bridge_marker       text,                           -- 'native' | 'wrapped' | NULL
  source_atom_id      uuid NOT NULL,
  materialized_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, tx_ref, edge_index)
);

CREATE INDEX IF NOT EXISTS case_subgraph_edges_from_idx
  ON belief.case_subgraph_edges (case_id, from_subject, block_height);
CREATE INDEX IF NOT EXISTS case_subgraph_edges_to_idx
  ON belief.case_subgraph_edges (case_id, to_subject, block_height);
CREATE INDEX IF NOT EXISTS case_subgraph_edges_kind_idx
  ON belief.case_subgraph_edges (case_id, edge_kind);
CREATE INDEX IF NOT EXISTS case_subgraph_edges_tx_idx
  ON belief.case_subgraph_edges (tx_ref);

CREATE TABLE IF NOT EXISTS belief.case_subgraph_nodes (
  case_id            uuid NOT NULL,
  subject_ref        text NOT NULL,
  subject_kind       text NOT NULL,
  chain              text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  in_edge_count      int NOT NULL DEFAULT 0,
  out_edge_count     int NOT NULL DEFAULT 0,
  total_in_minor     numeric(80, 0) NOT NULL DEFAULT 0,
  total_out_minor    numeric(80, 0) NOT NULL DEFAULT 0,
  attribution_count  int NOT NULL DEFAULT 0,
  sanctions_hit      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (case_id, subject_ref)
);

CREATE INDEX IF NOT EXISTS case_subgraph_nodes_chain_idx
  ON belief.case_subgraph_nodes (case_id, chain);
CREATE INDEX IF NOT EXISTS case_subgraph_nodes_sanctions_idx
  ON belief.case_subgraph_nodes (case_id) WHERE sanctions_hit = true;

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE belief.case_subgraph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief.case_subgraph_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_subgraph_edges_read  ON belief.case_subgraph_edges;
DROP POLICY IF EXISTS case_subgraph_edges_write ON belief.case_subgraph_edges;
DROP POLICY IF EXISTS case_subgraph_nodes_read  ON belief.case_subgraph_nodes;
DROP POLICY IF EXISTS case_subgraph_nodes_write ON belief.case_subgraph_nodes;

CREATE POLICY case_subgraph_edges_read ON belief.case_subgraph_edges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.case_subgraph_edges.case_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY case_subgraph_edges_write ON belief.case_subgraph_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY case_subgraph_nodes_read ON belief.case_subgraph_nodes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM belief.case_acl ca
      WHERE ca.case_id = belief.case_subgraph_nodes.case_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY case_subgraph_nodes_write ON belief.case_subgraph_nodes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE belief.case_subgraph_edges IS 'Denormalized per-case directed graph edges (v1.1 §6.3). Materialized from belief.atoms.';
COMMENT ON TABLE belief.case_subgraph_nodes IS 'Per-case node summaries with rollup counters. Materialized from belief.atoms.';
