# Graph Memory

`@agent-os/memory-graph` implements the core `Memory` interface with a typed
property graph. It stores base nodes, dynamic type details, weighted edges, and
embeddings. Text recall ranks vector seed nodes and then performs bounded,
weighted neighbor traversal.

## Install from the AgentOS Store

Open the dynamic app's **Store**, find **Graph Memory**, and choose **Install**.
The runtime automatically creates a dedicated SQLite namespace for the memory
instance, initializes its node, edge, and detail tables, and mounts the package's
management surface. No database path needs to be repeated in this package.

The management surface is a live WebGL graph console. It can create memories,
filter and inspect nodes, pause or resume ForceAtlas2 layout, zoom and fit the
graph, forget individual nodes, refresh storage, and clear the graph.

From the CLI:

```sh
npx agentos start
```

Then install `@agent-os/memory-graph` from the Store.

## Runtime use

```ts
const memory = new GraphMemory({
  database: provider.scope("memory-graph"),
  accessBoost: 0.1,
  halfLifeMs: 30 * 24 * 60 * 60 * 1000,
  traversalDepth: 2,
});

await memory.remember({
  id: "met-alice",
  kind: "episodic",
  content: {
    people: [{ name: "Alice", role: "designer", hobbies: ["climbing"] }],
  },
  createdAt: new Date(),
  userId: "user-1",
});
```

The default hash embedder is deterministic and dependency-free. For semantic
production retrieval, inject a model-backed `EmbeddingProvider`. To use a
dedicated vector database, inject a `VectorStore`; adapters only need
`upsert/query/remove`. A model-backed `EntityExtractor` can replace the
conservative built-in extractor for reliable entity recognition in free text.

`upsertNode`, `link`, and `neighbors` expose graph operations without changing
the `Memory` methods used by Agent OS. Node `data` is dynamic JSON, and custom
node and edge type strings are supported alongside the built-in enums.
