# @plaios/sqlite

Capability-scoped SQLite storage for PLAIOS, with a full management microfrontend.

## Features

- Isolated physical tables per capability namespace
- Typed `string`, `number`, `boolean`, `datetime`, and `json` columns
- Defaults, primary keys, unique constraints, indexes, filtering, ordering, and paging
- WAL mode, a five-second busy timeout, and foreign-key enforcement
- No native dependency: it uses Node's built-in `node:sqlite`
- Live database console for tables, rows, schemas, indexes, and SQL queries
- Explicit write confirmation in the query console

## Install

```bash
pnpm add @plaios/sqlite --registry http://localhost:4873
```

Node 22.5 or newer is required.

## Runtime

```ts
import { SQLiteDatabaseProvider } from "@plaios/sqlite";

const provider = new SQLiteDatabaseProvider({
  databasePath: ".agent-os/agent-os.sqlite",
});

const database = provider.scope("notes");

await database.init({
  tables: {
    notes: {
      primaryKey: "id",
      columns: {
        id: { type: "string", required: true },
        title: { type: "string", required: true },
        tags: { type: "json", default: [] },
        createdAt: { type: "datetime", required: true },
      },
      indexes: [{ columns: ["title"] }],
    },
  },
});

await database.add("notes", {
  id: "welcome",
  title: "Welcome to PLAIOS",
  createdAt: new Date(),
});

const note = await database.get("notes", "welcome");
await provider.close();
```

Namespaces are converted to physical table prefixes. The example above manages `notes__notes`; another capability cannot access it through its scoped database.

## Management microfrontend

The capability exports its database surface at `@plaios/sqlite/web/database` and its Tailwind entry at `@plaios/sqlite/web/styles.css`.

Pass the provider's opt-in admin bridge to the host surface:

```tsx
import SQLiteDatabaseMicrofrontend from "@plaios/sqlite/web/database";

<SQLiteDatabaseMicrofrontend
  component={component}
  data={provider.microfrontendData()}
  onSaveConfig={saveConfig}
/>
```

The console can:

- discover tables and namespace ownership;
- show live row counts;
- page through table rows;
- inspect columns, primary keys, indexes, and `CREATE TABLE` SQL;
- run `SELECT`, `PRAGMA`, and `EXPLAIN` statements;
- run writes only after the operator enables the confirmation checkbox.

The admin bridge is never exposed through the core scoped `Database` interface. Only pass it to trusted management surfaces.
