import { createGevActionRunner } from './gevActions.js';
import { createVoiceCommands } from './commands.js';
export * from './realtimeController.js';

/** Compose the standalone action runner with the voice controls. */
export function initGevVoiceCommands(options) {
  const runAction = createGevActionRunner(options);
  const commands = createVoiceCommands({
    ...options,
    runner: runAction,
  });
  commands.runAction = runAction;
  return commands;
}
