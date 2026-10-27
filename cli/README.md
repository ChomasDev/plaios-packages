# plaios

The command-line entrypoint for PLAIOS.

Start the dynamic capability host directly from the local registry:

```bash
npx --registry http://localhost:4873 plaios start
```

The first run creates `plaios.yaml`, installs the configured capability packages into `.agent-os/runtime`, and starts the swappable local control plane.

Create a new multi-interface capability package:

```bash
npx --registry http://localhost:4873 plaios create input,output telegram
```
