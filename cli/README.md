# agentos

The command-line entrypoint for Agent OS.

Start the dynamic capability host directly from the local registry:

```bash
npx --registry http://localhost:4873 agentos start
```

The first run creates `agent-os.yaml`, installs the configured capability packages into `.agent-os/runtime`, and starts the swappable local control plane.

Create a new multi-interface capability package:

```bash
npx --registry http://localhost:4873 agentos create input,output telegram
```
