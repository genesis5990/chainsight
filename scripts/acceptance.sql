-- Phase 1 acceptance walkthrough (v1.1 §8.6) — Supabase seed script.
--
-- Run from psql against the dev project to seed every table the Belief
-- State / Inspector / Tracer / Pathfinder / Pack stack reads. Idempotent:
-- re-running produces the same end state.
--
-- Usage:
--   PGPASSWORD=<service_role_secret> psql -h db.<ref>.supabase.co -U postgres -d postgres -f scripts/acceptance.sql
-- or via the Supabase SQL editor.
--
-- After this script lands, run scripts/acceptance.ts to build the pack
-- and confirm determinism + verifier verdict.

-- ── Constants ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_case_id uuid := '00000000-0000-0000-0000-acceacceacce';
  v_user_id uuid := '00000000-0000-0000-0000-1111aaaa1111';
  v_trace_id uuid := '019eebc0-0000-0000-acce-0000acceacce';
  v_tx_atom jsonb;
  v_parent uuid;
BEGIN
  -- Step 1: case_acl seed
  INSERT INTO belief.case_acl (case_id, user_id, can_read, can_write, granted_by)
  VALUES (v_case_id, v_user_id, true, true, v_user_id)
  ON CONFLICT DO NOTHING;

  -- Skip if atoms already exist (idempotency).
  IF EXISTS (SELECT 1 FROM belief.atoms WHERE case_id = v_case_id) THEN
    RAISE NOTICE 'Acceptance fixture already seeded; skipping atom emission.';
    RETURN;
  END IF;

  -- ── Step 2: Inspector run (6 atoms) ─────────────────────────────────
  v_tx_atom := belief.insert_atom_with_event(v_case_id, 'evm:1_tx:0xacc1', 'tx', 'tx_exists',
    jsonb_build_object('tx_hash','0xacc1','block_height',100,'block_time_utc','2026-04-09T14:31:00Z','from','evm:1_addr:0xvictim','to','evm:1_addr:0xbridge'),
    'T0','inspector run section 1', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','seed'),
    '[]'::jsonb,'agent',v_user_id,NULL,NULL, decode(md5('tx_exists|0xacc1'),'hex'));
  v_parent := (v_tx_atom->'atom'->>'id')::uuid;

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xvictim','address','address_sent',
    jsonb_build_object('tx_hash','0xacc1','counterparty','evm:1_addr:0xbridge','value_native_minor','10000000000000000000','block_height',100,'edge_index',0),
    'T0','inspector run section 2', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','seed'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('address_sent|0xvictim|0xacc1'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xbridge','address','address_received',
    jsonb_build_object('tx_hash','0xacc1','counterparty','evm:1_addr:0xvictim','value_native_minor','10000000000000000000','block_height',100,'edge_index',0),
    'T0','inspector run section 2', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','seed'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('address_received|0xbridge|0xacc1'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_tx:0xacc1','tx','has_value_at_block',
    jsonb_build_object('value_native_minor','10000000000000000000','value_fiat','20000.00','fiat_currency','USD','block_height',100,'recipe_hash','math:recipe:value@v1'),
    'T2','inspector section 4', jsonb_build_object('value',0.95,'inputs',jsonb_build_object('basis_tier','T2'),'recipe_hash','math:recipe:value@v1'),
    '[]'::jsonb,'agent',v_user_id,v_parent,jsonb_build_object('rpc','ComputeValueAtBlock','recipe_hash','math:recipe:value@v1'),
    decode(md5('has_value_at_block|0xacc1'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xbridge','address','has_attribution',
    jsonb_build_object('label','Bridge contract','category','bridge','source_dataset','opensanctions','confidence',0.85,'subject_ref','evm:1_addr:0xbridge'),
    'T2','inspector section 6', jsonb_build_object('value',0.85,'inputs',jsonb_build_object('basis_tier','T2','provider_corroboration_count',1),'recipe_hash','attr:opensanctions@v1'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('has_attribution|0xbridge'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_tx:0xacc1','tx','inspector_run_completed',
    jsonb_build_object('tx_ref','evm:1_tx:0xacc1','methodology','fifo','section_count',8,'cited_atom_count',5),
    'T0','inspector section 8 (terminal)', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','inspector@v1'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('inspector_run_completed|0xacc1'),'hex'));

  -- ── Step 3: Tracer run (hop 1: bridge -> ransom) ────────────────────
  v_tx_atom := belief.insert_atom_with_event(v_case_id,'evm:1_tx:0xbridge2ransom','tx','tx_exists',
    jsonb_build_object('tx_hash','0xbridge2ransom','block_height',110,'from','evm:1_addr:0xbridge','to','evm:1_addr:0xransom','trace_job_id',v_trace_id),
    'T0','tracer hop 1', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,NULL,NULL, decode(md5('tracer:hop1:tx'),'hex'));
  v_parent := (v_tx_atom->'atom'->>'id')::uuid;

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xbridge','address','address_sent',
    jsonb_build_object('tx_hash','0xbridge2ransom','counterparty','evm:1_addr:0xransom','value_native_minor','10000000000000000000','block_height',110,'edge_index',0,'trace_job_id',v_trace_id),
    'T0','tracer hop 1', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop1:sent'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xransom','address','address_received',
    jsonb_build_object('tx_hash','0xbridge2ransom','counterparty','evm:1_addr:0xbridge','value_native_minor','10000000000000000000','block_height',110,'edge_index',0,'trace_job_id',v_trace_id),
    'T0','tracer hop 1', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop1:recv'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xransom','address','has_taint_share',
    jsonb_build_object('taint_share',1.0,'origin_count',1,'methodology','fifo','trace_job_id',v_trace_id),
    'T2','tracer hop 1', jsonb_build_object('value',0.95,'inputs',jsonb_build_object('basis_tier','T2'),'recipe_hash','tracer-taint@v1'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop1:taint'),'hex'));

  -- Hop 2: ransom -> exchange
  v_tx_atom := belief.insert_atom_with_event(v_case_id,'evm:1_tx:0xransom2exch','tx','tx_exists',
    jsonb_build_object('tx_hash','0xransom2exch','block_height',125,'from','evm:1_addr:0xransom','to','evm:1_addr:0xexchange','trace_job_id',v_trace_id),
    'T0','tracer hop 2', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,NULL,NULL, decode(md5('tracer:hop2:tx'),'hex'));
  v_parent := (v_tx_atom->'atom'->>'id')::uuid;

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xransom','address','address_sent',
    jsonb_build_object('tx_hash','0xransom2exch','counterparty','evm:1_addr:0xexchange','value_native_minor','5000000000000000000','block_height',125,'edge_index',0,'trace_job_id',v_trace_id),
    'T0','tracer hop 2', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop2:sent'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xexchange','address','address_received',
    jsonb_build_object('tx_hash','0xransom2exch','counterparty','evm:1_addr:0xransom','value_native_minor','5000000000000000000','block_height',125,'edge_index',0,'trace_job_id',v_trace_id),
    'T0','tracer hop 2', jsonb_build_object('value',1.0,'inputs',jsonb_build_object('basis_tier','T0'),'recipe_hash','tracer'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop2:recv'),'hex'));

  PERFORM belief.insert_atom_with_event(v_case_id,'evm:1_addr:0xexchange','address','has_taint_share',
    jsonb_build_object('taint_share',0.5,'origin_count',1,'methodology','fifo','trace_job_id',v_trace_id),
    'T2','tracer hop 2', jsonb_build_object('value',0.9,'inputs',jsonb_build_object('basis_tier','T2'),'recipe_hash','tracer-taint@v1'),
    '[]'::jsonb,'agent',v_user_id,v_parent,NULL, decode(md5('tracer:hop2:taint'),'hex'));

  -- inspector_runs row
  INSERT INTO belief.inspector_runs (
    case_id, tx_ref, methodology, ran_by_id,
    section_header, section_parties, section_decoded, section_value_fees,
    section_methodology, section_attribution, section_narrative, section_citations,
    recipe_hash_bundle, cache_key, emitted_atom_ids
  )
  VALUES (
    v_case_id,'evm:1_tx:0xacc1','fifo',v_user_id,
    jsonb_build_object('tx_ref','evm:1_tx:0xacc1','block_height',100),
    jsonb_build_object('parties', jsonb_build_array(
      jsonb_build_object('role','from','address_ref','evm:1_addr:0xvictim'),
      jsonb_build_object('role','to','address_ref','evm:1_addr:0xbridge'))),
    jsonb_build_object('action_kind','transfer','confidence',1.0,'decoded',jsonb_build_object()),
    jsonb_build_object('value_native_minor','10000000000000000000','fiat_currency','USD','value_fiat','20000.00','fee_native_minor','420000000000000','math_recipe_hashes',jsonb_build_object('value','math:recipe:value@v1','fee','math:recipe:fee@v1')),
    jsonb_build_object('methodology','fifo','applied',true),
    jsonb_build_object('attributions', jsonb_build_array(
      jsonb_build_object('subject_ref','evm:1_addr:0xbridge','label','Bridge contract','category','bridge','confidence',0.85))),
    jsonb_build_object('text','Wallet sent 10 ETH to a bridge contract.','token_count',32),
    jsonb_build_object('cited_atom_count',5,'uncited_count',0),
    jsonb_build_object('decoded_action','d1','value_fees','vf1','methodology','m1','counterparty_attribution','ca1'),
    'cache_acc1',
    ARRAY(SELECT id FROM belief.atoms WHERE case_id = v_case_id)
  );

  -- trace_jobs row
  INSERT INTO belief.trace_jobs (
    id, case_id, initiated_by_id, mode, origin, direction, methodology, params,
    idempotency_key, status, started_at, completed_at,
    total_hops, total_atoms_emitted, total_budget_spent_usd,
    provider_response_hashes, termination_reason
  )
  VALUES (
    v_trace_id, v_case_id, v_user_id, 'autonomous',
    ARRAY['evm:1_addr:0xvictim'], 'forward','fifo',
    jsonb_build_object('max_hops_per_path',12,'budget_usd',5,'taint_threshold',0.01),
    'idem-' || encode(decode(md5(v_case_id::text || v_trace_id::text),'hex'),'hex'),
    'completed', now() - interval '1 minute', now(),
    2, 8, 0.024,
    jsonb_build_array(md5('hop1_response'), md5('hop2_response')),
    'attribution_terminal'
  );

  -- Pathfinder subgraph materialization (mimics GraphMaterializer)
  INSERT INTO belief.case_subgraph_edges (case_id, chain, from_subject, to_subject, edge_kind, tx_ref, edge_index, block_height, block_time, value_minor, source_atom_id)
  SELECT
    a.case_id, 'evm:1',
    a.subject_ref,
    (a.object_payload->>'counterparty')::text,
    'tx_native',
    'evm:1_tx:' || (a.object_payload->>'tx_hash'),
    COALESCE((a.object_payload->>'edge_index')::int, 0),
    COALESCE((a.object_payload->>'block_height')::bigint, 0),
    COALESCE((a.object_payload->>'block_time_utc')::timestamptz, now()),
    COALESCE((a.object_payload->>'value_native_minor')::numeric, 0),
    a.id
  FROM belief.atoms a
  WHERE a.case_id = v_case_id AND a.predicate = 'address_sent'
  ON CONFLICT (case_id, tx_ref, edge_index) DO NOTHING;

  INSERT INTO belief.case_subgraph_nodes (case_id, subject_ref, subject_kind, chain)
  SELECT DISTINCT case_id, from_subject, 'address', 'evm:1' FROM belief.case_subgraph_edges WHERE case_id = v_case_id
  UNION
  SELECT DISTINCT case_id, to_subject, 'address', 'evm:1' FROM belief.case_subgraph_edges WHERE case_id = v_case_id
  ON CONFLICT (case_id, subject_ref) DO NOTHING;

  RAISE NOTICE 'Acceptance fixture seeded.';
END $$;

-- ── Verification queries ────────────────────────────────────────────────
SELECT 'atoms'                AS metric, count(*)::text AS value FROM belief.atoms                WHERE case_id = '00000000-0000-0000-0000-acceacceacce'
UNION ALL SELECT 'events',                count(*)::text         FROM belief.events               WHERE case_id = '00000000-0000-0000-0000-acceacceacce'
UNION ALL SELECT 'inspector_runs',        count(*)::text         FROM belief.inspector_runs       WHERE case_id = '00000000-0000-0000-0000-acceacceacce'
UNION ALL SELECT 'trace_jobs',            count(*)::text         FROM belief.trace_jobs           WHERE case_id = '00000000-0000-0000-0000-acceacceacce'
UNION ALL SELECT 'case_subgraph_edges',   count(*)::text         FROM belief.case_subgraph_edges  WHERE case_id = '00000000-0000-0000-0000-acceacceacce'
UNION ALL SELECT 'case_subgraph_nodes',   count(*)::text         FROM belief.case_subgraph_nodes  WHERE case_id = '00000000-0000-0000-0000-acceacceacce';
