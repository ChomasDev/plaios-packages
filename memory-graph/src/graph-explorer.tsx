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
import { installNodeDragging, type ForceLayout } from "./graph-dragging.js";

export function GraphExplorer({
  nodes,
  edges,
  query,
  hiddenTypes,
  edgeMode,
  selectedId,
  onSelect,
}: {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  query: string;
  hiddenTypes: string[];
  edgeMode: "context" | "all";
  selectedId?: string;
  onSelect: (id?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma<
    MemoryNodeAttributes,
    MemoryEdgeAttributes
  > | null>(null);
  const layoutRef = useRef<(ForceLayout & { kill(): void }) | null>(null);
  const [running, setRunning] = useState(true);
  const [hoveredId, setHoveredId] = useState<string>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const graph = buildGraph(nodes, edges);
    const renderer = new Sigma(graph, container, {
      allowInvalidContainer: true,
      defaultEdgeColor: "#64748b",
      hideEdgesOnMove: true,
      labelColor: { color: "#a7b0be" },
      labelDensity: 0.16,
      labelFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
      labelRenderedSizeThreshold: 8,
      labelSize: 10,
      renderEdgeLabels: false,
      stagePadding: 64,
      zIndex: true,
    });
    const FA2Layout = FA2LayoutModule as unknown as ForceLayoutConstructor;
    const layout = new FA2Layout(graph, {
      settings: {
        barnesHutOptimize: true,
        adjustSizes: true,
        edgeWeightInfluence: 0.2,
        gravity: 1.8,
        linLogMode: true,
        scalingRatio: 18,
        slowDown: 7,
        strongGravityMode: true,
      },
    });
    renderer.on("clickNode", ({ node }) => onSelect(node));
    renderer.on("clickStage", () => onSelect());
    renderer.on("enterNode", ({ node }) => {
      setHoveredId(node);
      container.style.cursor = "pointer";
    });
    renderer.on("leaveNode", () => {
      setHoveredId(undefined);
      container.style.cursor = "default";
    });
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
    const disabled = new Set(hiddenTypes);
    const matches = new Set(
      graph.filterNodes((_, data) =>
        !disabled.has(data.nodeType) && data.searchable.includes(normalized),
      ),
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
      color: node === selectedId ? "#34d399" : data.color,
      hidden: disabled.has(data.nodeType) || Boolean(normalized && !visible.has(node)),
      highlighted: labelMatches.has(node) || node === selectedId || node === hoveredId,
      label:
        labelMatches.has(node) || node === selectedId || node === hoveredId
          ? data.fullLabel
          : data.label,
      size: node === selectedId ? data.size * 1.7 : node === hoveredId ? data.size * 1.3 : data.size,
      zIndex: node === selectedId || node === hoveredId ? 2 : 1,
    }));
    renderer.setSetting("edgeReducer", (edge, data) => {
      const [source, target] = graph.extremities(edge);
      const sourceData = graph.getNodeAttributes(source);
      const targetData = graph.getNodeAttributes(target);
      const filtered = disabled.has(sourceData.nodeType) || disabled.has(targetData.nodeType);
      const outsideSearch = normalized && (!visible.has(source) || !visible.has(target));
      const focus = selectedId ?? hoveredId;
      const outsideContext = edgeMode === "context" && (!focus || (source !== focus && target !== focus));
      const emphasized = Boolean(focus && (source === focus || target === focus));
      return {
        ...data,
        hidden: filtered || Boolean(outsideSearch) || outsideContext,
        color: emphasized ? "rgba(52, 211, 153, 0.72)" : data.color,
        size: emphasized ? Math.max(1, data.size * 1.8) : data.size,
        zIndex: emphasized ? 2 : 0,
      };
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
  }, [edgeMode, hiddenTypes, hoveredId, query, selectedId]);

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
      <div className="absolute bottom-3 left-3 z-10 flex gap-1">
        <Control
          label={running ? "Pause gravity" : "Resume gravity"}
          onClick={toggleLayout}
        >
          {running ? "II" : ">"}
        </Control>
        <Control label="Zoom in" onClick={() => zoom(1.35)}>
          +
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
          FIT
        </Control>
      </div>
    </div>
  );
}

type ForceLayoutConstructor = new (
  graph: ReturnType<typeof buildGraph>,
  options: { settings: Record<string, boolean | number> },
) => ForceLayout & { kill(): void };
