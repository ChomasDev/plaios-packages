import type Sigma from "sigma";
import type {
  MemoryEdgeAttributes,
  MemoryGraph,
  MemoryNodeAttributes,
} from "./graph-view-model.js";

export interface ForceLayout {
  isRunning(): boolean;
  start(): void;
  stop(): void;
}

export function installNodeDragging(
  renderer: Sigma<MemoryNodeAttributes, MemoryEdgeAttributes>,
  graph: MemoryGraph,
  layout: ForceLayout,
  onResume: () => void,
) {
  let draggedNode: string | undefined;
  let resumeLayout = false;
  renderer.on("downNode", ({ node }) => {
    draggedNode = node;
    resumeLayout = layout.isRunning();
    layout.stop();
    graph.setNodeAttribute(node, "highlighted", true);
    renderer.getCamera().disable();
  });
  renderer.getMouseCaptor().on("mousemovebody", (event) => {
    if (!draggedNode) return;
    const position = renderer.viewportToGraph(event);
    graph.mergeNodeAttributes(draggedNode, position);
  });
  renderer.getMouseCaptor().on("mouseup", () => {
    if (!draggedNode) return;
    graph.removeNodeAttribute(draggedNode, "highlighted");
    draggedNode = undefined;
    renderer.getCamera().enable();
    if (!resumeLayout) return;
    layout.start();
    onResume();
  });
}
