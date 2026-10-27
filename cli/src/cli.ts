#!/usr/bin/env node

import { main } from "@plaios/package-manager";

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
