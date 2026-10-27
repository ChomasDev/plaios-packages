# @plaios/systems

Shared helpers for plugins that think with **System 1** and **System 2**.

- **System 1** (`kind: system1`, e.g. `@plaios/system1-jev`): fast typed judgments. Optional.
- **System 2** (`kind: system2`, e.g. `@plaios/codex`): the generative model. Its `ask` answers the same questions in the same shape (`askWithFunctionCall`).

Contracts (`System1`, `System2`, `SystemQuestions`, `SystemAnswers`) live in `@plaios/core/domain`.
This package has the `choice` / `noul` builders, `noulOf`, `compactTurns` and remembered protocols.

## Adding System 1/2 to a plugin

1. Depend on `"@plaios/systems": "workspace:*"`.
2. In `agent-os.package.yaml`: `required: [env, system2]` and `optional: [system1]`.
   The runtime injects them as `options.system1` / `options.system2`.
   `system1Instance` / `system2Instance` config keys pick a specific component by instanceId.
3. In the plugin:

   ```ts
   const answers = this.system1
     ? await this.system1.ask(state, { action: choice(...), on: noul(...) }, { signal })
     : await this.system2.ask(state, questions, { signal });
   ```

   See the `ask` method in `action-home-assistant/src/jev.ts` for the version with fallback.
