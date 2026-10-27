import type { OpenUIComponentSpec } from "@agent-os/microfrontend";

/** Shared by the backend (prompt) and the web module (renderer). */
export const MEMORY_GRAPH_OPENUI: OpenUIComponentSpec = {
  name: "MemoryGraph",
  description: "A preview of what the agent remembers about a person, place or topic: the matching memory node with the memories and entities linked to it, explorable by clicking. Use it for questions like \"who is X\", \"what do you know about Y\" or \"what do you remember about Z\" whenever memory holds something about them, alongside your written answer.",
  props: [
    { name: "focus", type: "string", description: "Name of the person, entity or topic to center on, as it appears in memory." },
    { name: "depth", type: "number", optional: true, description: "How many hops of linked memories to include: 1 (default) or 2." },
  ],
};
