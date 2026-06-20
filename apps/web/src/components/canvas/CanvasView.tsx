'use client';

/**
 * Surface 2 — Canvas view (Sigma.js v3 + WebGL).
 *
 * Renders the transaction-centric graph: AddressNodes as circles,
 * TransactionNodes as squares (sigma 3 has no diamond primitive — visually
 * distinct from circles is sufficient at this density). Color discipline
 * comes from the SemanticFamily of each node.
 *
 * This component is client-only and must be loaded via next/dynamic
 * with ssr:false (Sigma touches window/canvas at module load).
 */

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Sigma } from 'sigma';
import { useEffect, useRef } from 'react';
import {
  ACTIVITY_GLYPH,
  ENTITY_GLYPH,
  FAMILY_HEX,
  PATH_HEX,
  type CanvasCaseGraph,
  type CanvasLayerToggles,
  type CanvasNodeId,
  type TaintMethodology,
} from '@chainsight/shared-types';

export interface CanvasViewProps {
  graph: CanvasCaseGraph;
  layers: CanvasLayerToggles;
  methodology: TaintMethodology;
  /** Fires when the investigator clicks a node. */
  onNodeClick?: (nodeId: CanvasNodeId, kind: 'address' | 'transaction') => void;
  /** Fires when the investigator clicks the empty canvas. */
  onCanvasClick?: () => void;
}

export function CanvasView({
  graph,
  layers,
  methodology: _methodology, // reserved — drives cumulative-taint overlay coloring (Phase 1)
  onNodeClick,
  onCanvasClick,
}: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  // Stable ref to the latest click handlers so we don't rebuild the graph
  // every time the parent re-renders for non-graph reasons.
  const handlersRef = useRef({ onNodeClick, onCanvasClick });
  handlersRef.current = { onNodeClick, onCanvasClick };

  // Rebuild the graph when seed data or visibility toggles change.
  useEffect(() => {
    if (!containerRef.current) return;

    const g = new Graph({ type: 'directed', multi: true });

    // Add nodes.
    for (const node of graph.nodes) {
      if (layers.hide_context_only && node.family === 'context') continue;

      const baseColor = FAMILY_HEX[node.family];
      const isTx = node.kind === 'transaction';
      const baseSize = isTx ? 8 : 11;
      const sizeBoost = node.marked_important ? 4 : 0;

      // Build display label.
      let labelParts: string[] = [];
      if (layers.show_marker_icons) {
        if (isTx) labelParts.push(ACTIVITY_GLYPH[node.activity_icon]);
        else labelParts.push(ENTITY_GLYPH[node.entity_icon]);
      }
      if (layers.show_address_labels) {
        if (isTx) {
          labelParts.push(`tx ${node.tx_hash.slice(0, 8)}…`);
        } else {
          labelParts.push(node.label ?? node.address.slice(0, 14) + '…');
        }
      }

      g.addNode(node.id, {
        x: Math.random(), // seeded by forceAtlas later
        y: Math.random(),
        size: baseSize + sizeBoost,
        color: baseColor.fill,
        // sigma supports a small set of programs by default. We extend
        // 'square' for transactions, 'circle' for addresses.
        type: isTx ? 'square' : 'circle',
        label: labelParts.join(' '),
        // Stash kind for click routing.
        kind: node.kind,
        family: node.family,
        marked_important: node.marked_important ?? false,
      });
    }

    // Add edges — skip any whose endpoint was filtered out.
    for (const edge of graph.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;

      // Edge color: if the edge is in a path AND path rings are visible,
      // use the path color (first path wins for now). Otherwise gray.
      let edgeColor = '#cbd5e1';
      if (layers.show_path_rings && edge.path_ids && edge.path_ids.length > 0) {
        const firstPath = graph.paths.find((p) => p.id === edge.path_ids![0]);
        if (firstPath) edgeColor = PATH_HEX[firstPath.color];
      }

      // Edge thickness scales with absolute value (log scale per canvas UX §2.2).
      const v = Number(edge.absolute_value_native.split(' ')[0]) || 0;
      const size = Math.max(1, Math.min(8, 1 + Math.log10(v + 1) * 2));

      g.addEdge(edge.source, edge.target, {
        size,
        color: edgeColor,
        type: 'arrow',
        label: layers.show_value_labels
          ? `${edge.absolute_value_native}${
              edge.share_of_parent_tx < 1
                ? ` (${(edge.share_of_parent_tx * 100).toFixed(0)}%)`
                : ''
            }`
          : '',
        edge_id: edge.id,
      });
    }

    // Run force-atlas to lay out the graph.
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: 200,
        settings: {
          gravity: 1.2,
          scalingRatio: 12,
          slowDown: 4,
          barnesHutOptimize: g.order > 100,
          adjustSizes: true,
        },
      });
    }

    // Instantiate Sigma.
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    const sigma = new Sigma(g, containerRef.current, {
      renderEdgeLabels: layers.show_value_labels,
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: '#374151' },
      edgeLabelSize: 10,
      edgeLabelColor: { color: '#6b7280' },
      defaultEdgeType: 'arrow',
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    });

    sigma.on('clickNode', ({ node }) => {
      const attrs = g.getNodeAttributes(node);
      handlersRef.current.onNodeClick?.(
        node as CanvasNodeId,
        attrs.kind as 'address' | 'transaction',
      );
    });
    sigma.on('clickStage', () => {
      handlersRef.current.onCanvasClick?.();
    });
    // Hover highlight via cursor + slight scale bump.
    sigma.on('enterNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = '';
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph, layers]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      role="img"
      aria-label={`Case graph: ${graph.case_name}`}
    />
  );
}
