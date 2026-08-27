"use client";

import { useEffect, useRef, useState } from "react";
import FA2LayoutModule from "graphology-layout-forceatlas2/worker.js";
import Sigma from "sigma";
import { Control } from "./graph-controls.js";
import {
  buildGraph,
  type GraphEdgeDto,
  type GraphNodeDto,
  type MemoryEdgeAttributes,
  type MemoryNodeAttributes,
} from "./graph-view-model.js";
import { installNodeDragging } from "./graph-dragging.js";

export function GraphExplorer({
  nodes,
  edges,
  query,
  selectedId,
  onSelect,
}: {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  query: string;
  selectedId?: string;
  onSelect: (id?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma<
    MemoryNodeAttributes,
    MemoryEdgeAttributes
  > | null>(null);
  const layoutRef = useRef<ForceLayout | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const graph = buildGraph(nodes, edges);
    const renderer = new Sigma(graph, container, {
      allowInvalidContainer: true,
      defaultEdgeColor: "#64748b",
      hideEdgesOnMove: true,
      labelColor: { color: "#94a3b8" },
      labelDensity: 0.2,
      labelRenderedSizeThreshold: 7,
      renderEdgeLabels: false,
      stagePadding: 42,
      zIndex: true,
    });
    const FA2Layout = FA2LayoutModule as unknown as ForceLayoutConstructor;
    const layout = new FA2Layout(graph, {
      settings: {
        barnesHutOptimize: true,
        edgeWeightInfluence: 0.35,
        gravity: 1.2,
        linLogMode: true,
        scalingRatio: 12,
        slowDown: 5,
      },
    });
    renderer.on("clickNode", ({ node }) => onSelect(node));
    renderer.on("clickStage", () => onSelect());
    installNodeDragging(renderer, graph, layout, () => setRunning(true));
    rendererRef.current = renderer;
    layoutRef.current = layout;
    layout.start();
    setRunning(true);
    return () => {
      layout.kill();
      renderer.kill();
      rendererRef.current = null;
      layoutRef.current = null;
    };
  }, [edges, nodes, onSelect]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const normalized = query.trim().toLowerCase();
    const graph = renderer.getGraph();
    const matches = new Set(
      graph.filterNodes((_, data) => data.searchable.includes(normalized)),
    );
    const labelMatches = new Set(
      [...matches]
        .sort((left, right) => {
          const leftHasLabel = graph.getNodeAttribute(left, "label") ? 1 : 0;
          const rightHasLabel = graph.getNodeAttribute(right, "label") ? 1 : 0;
          return rightHasLabel - leftHasLabel;
        })
        .slice(0, 6),
    );
    const visible = new Set(matches);
    if (normalized) {
      for (const node of matches) {
        graph.forEachNeighbor(node, (neighbor) => visible.add(neighbor));
      }
    }
    renderer.setSetting("nodeReducer", (node, data) => ({
      ...data,
      color: node === selectedId ? "#ffffff" : data.color,
      hidden: Boolean(normalized && !visible.has(node)),
      highlighted: labelMatches.has(node) || node === selectedId,
      label:
        labelMatches.has(node) || node === selectedId
          ? data.fullLabel
          : data.label,
      size: node === selectedId ? data.size * 1.6 : data.size,
      zIndex: node === selectedId ? 2 : 1,
    }));
    renderer.setSetting("edgeReducer", (edge, data) => {
      const [source, target] = graph.extremities(edge);
      const hidden = normalized
        ? !visible.has(source) || !visible.has(target)
        : false;
      return { ...data, hidden };
    });
    renderer.refresh();
    if (normalized && matches.size > 0 && matches.size <= 12) {
      const positions = [...matches]
        .map((node) => renderer.getNodeDisplayData(node))
        .filter((item) => item !== undefined);
      const x =
        positions.reduce((sum, item) => sum + item.x, 0) / positions.length;
      const y =
        positions.reduce((sum, item) => sum + item.y, 0) / positions.length;
      void renderer
        .getCamera()
        .animate(
          { x, y, ratio: matches.size === 1 ? 0.18 : 0.35 },
          { duration: 350 },
        );
    }
  }, [query, selectedId]);

  function toggleLayout() {
    const layout = layoutRef.current;
    if (!layout) return;
    if (layout.isRunning()) layout.stop();
    else layout.start();
    setRunning(layout.isRunning());
  }

  function zoom(factor: number) {
    rendererRef.current?.getCamera().animatedZoom({ duration: 220, factor });
  }

  return (
    <div className="graph-explorer relative size-full">
      <div ref={containerRef} className="graph-container size-full" />
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <Control
          label={running ? "Pause gravity" : "Resume gravity"}
          onClick={toggleLayout}
        >
          {running ? "Ⅱ" : "▶"}
        </Control>
        <Control label="Zoom in" onClick={() => zoom(1.35)}>
          ＋
        </Control>
        <Control label="Zoom out" onClick={() => zoom(0.75)}>
          −
        </Control>
        <Control
          label="Fit graph"
          onClick={() =>
            rendererRef.current?.getCamera().animatedReset({ duration: 350 })
          }
        >
          ↗
        </Control>
      </div>
    </div>
  );
}

interface ForceLayout {
  isRunning(): boolean;
  start(): void;
  stop(): void;
  kill(): void;
}

type ForceLayoutConstructor = new (
  graph: ReturnType<typeof buildGraph>,
  options: { settings: Record<string, boolean | number> },
) => ForceLayout;
