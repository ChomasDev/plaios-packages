"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import { Control } from "./graph-controls.js";
import {
  buildThreeGraphData,
  type GraphEdgeDto,
  type GraphNodeDto,
  type ThreeGraphLink,
  type ThreeGraphNode,
} from "./graph-view-model.js";

type GraphNode = NodeObject<ThreeGraphNode>;
type GraphLink = LinkObject<ThreeGraphNode, ThreeGraphLink>;

export function GraphExplorer3D({
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
  const frameRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<ThreeGraphNode, ThreeGraphLink> | undefined>(undefined);
  const didFitRef = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hoveredId, setHoveredId] = useState<string>();
  const [settled, setSettled] = useState(false);
  const graphData = useMemo(() => buildThreeGraphData(nodes, edges), [edges, nodes]);
  const nodeTypeById = useMemo(
    () => new Map(graphData.nodes.map(({ id, type }) => [id, type])),
    [graphData.nodes],
  );
  const adjacency = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const { sourceId, targetId } of edges) {
      if (!result.has(sourceId)) result.set(sourceId, new Set());
      if (!result.has(targetId)) result.set(targetId, new Set());
      result.get(sourceId)!.add(targetId);
      result.get(targetId)!.add(sourceId);
    }
    return result;
  }, [edges]);
  const disabled = useMemo(() => new Set(hiddenTypes), [hiddenTypes]);
  const normalized = query.trim().toLowerCase();
  const visibleIds = useMemo(() => {
    const matches = new Set(
      graphData.nodes
        .filter((node) => !disabled.has(node.type) && node.searchable.includes(normalized))
        .map(({ id }) => id),
    );
    if (!normalized) return matches;
    const visible = new Set(matches);
    for (const id of matches) {
      for (const neighbor of adjacency.get(id) ?? []) visible.add(neighbor);
    }
    return visible;
  }, [adjacency, disabled, graphData.nodes, normalized]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateSize = () => {
      const bounds = frame.getBoundingClientRect();
      setSize({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    didFitRef.current = false;
    setSettled(false);
  }, [graphData]);

  useEffect(() => {
    graphRef.current?.refresh();
  }, [disabled, edgeMode, hoveredId, normalized, selectedId, visibleIds]);

  const isNodeVisible = useCallback(
    (node: GraphNode) => !disabled.has(node.type) && (!normalized || visibleIds.has(String(node.id))),
    [disabled, normalized, visibleIds],
  );
  const isLinkVisible = useCallback(
    (link: GraphLink) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      const sourceType = nodeTypeById.get(source);
      const targetType = nodeTypeById.get(target);
      if (!sourceType || !targetType || disabled.has(sourceType) || disabled.has(targetType)) return false;
      if (normalized && (!visibleIds.has(source) || !visibleIds.has(target))) return false;
      const focus = selectedId ?? hoveredId;
      return edgeMode === "all" || Boolean(focus && (source === focus || target === focus));
    },
    [disabled, edgeMode, hoveredId, nodeTypeById, normalized, selectedId, visibleIds],
  );
  const isFocusedLink = useCallback(
    (link: GraphLink) => {
      const focus = selectedId ?? hoveredId;
      return Boolean(focus && (endpointId(link.source) === focus || endpointId(link.target) === focus));
    },
    [hoveredId, selectedId],
  );

  useEffect(() => {
    if (!normalized) return;
    const timeout = window.setTimeout(
      () => graphRef.current?.zoomToFit(500, 96, isNodeVisible),
      120,
    );
    return () => window.clearTimeout(timeout);
  }, [isNodeVisible, normalized, visibleIds]);

  function focusNode(node: GraphNode) {
    const id = String(node.id);
    onSelect(id);
    const point = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
    const length = Math.hypot(point.x, point.y, point.z);
    const distance = 90;
    const ratio = length > 0 ? 1 + distance / length : 1;
    graphRef.current?.cameraPosition(
      length > 0
        ? { x: point.x * ratio, y: point.y * ratio, z: point.z * ratio }
        : { x: 0, y: 0, z: distance },
      point,
      650,
    );
  }

  return (
    <div ref={frameRef} className="graph-explorer graph-explorer-3d relative size-full">
      <ForceGraph3D<ThreeGraphNode, ThreeGraphLink>
        ref={graphRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        showNavInfo={false}
        nodeId="id"
        nodeVal={(node) => node.val * (String(node.id) === selectedId ? 1.8 : String(node.id) === hoveredId ? 1.3 : 1)}
        nodeColor={(node) => String(node.id) === selectedId ? "#34d399" : String(node.id) === hoveredId ? "#e2e8f0" : node.color}
        nodeLabel={(node) => `<div class="graph-node-tooltip"><b>${escapeHtml(node.label)}</b><span>${escapeHtml(node.type)} · ${escapeHtml(String(node.id))}</span></div>`}
        nodeVisibility={isNodeVisible}
        nodeOpacity={0.92}
        nodeResolution={8}
        linkVisibility={isLinkVisible}
        linkColor={(link) => isFocusedLink(link) ? "#34d399" : "#64748b"}
        linkWidth={(link) => isFocusedLink(link) ? 1.6 : Math.max(0.65, link.weight * 0.9)}
        linkOpacity={edgeMode === "all" ? 0.58 : 0.82}
        enableNodeDrag
        enableNavigationControls
        d3AlphaDecay={0.028}
        d3VelocityDecay={0.32}
        cooldownTicks={260}
        onNodeHover={(node) => setHoveredId(node ? String(node.id) : undefined)}
        onNodeClick={focusNode}
        onBackgroundClick={() => onSelect()}
        onEngineTick={() => setSettled(false)}
        onEngineStop={() => {
          setSettled(true);
          if (!didFitRef.current) {
            didFitRef.current = true;
            graphRef.current?.zoomToFit(500, 72, isNodeVisible);
          }
        }}
      />
      <div className="graph-axis" aria-hidden="true"><i className="x" /><i className="y" /><i className="z" /><span>XYZ</span></div>
      <div className="absolute bottom-3 left-3 z-10 flex gap-1">
        <Control label="Reheat spatial layout" onClick={() => { setSettled(false); graphRef.current?.d3ReheatSimulation(); }}>RUN</Control>
        <Control label="Fit visible graph" onClick={() => graphRef.current?.zoomToFit(450, 72, isNodeVisible)}>FIT</Control>
        <Control label="Reset camera" onClick={() => graphRef.current?.cameraPosition({ x: 0, y: 0, z: 420 }, { x: 0, y: 0, z: 0 }, 450)}>0</Control>
      </div>
      <div className="graph-spatial-status"><span className={settled ? "settled" : ""} />{settled ? "SIMULATION STABLE" : "SOLVING 3D LAYOUT"}</div>
    </div>
  );
}

function endpointId(value: GraphLink["source"]): string {
  return typeof value === "object" ? String(value.id) : String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}
