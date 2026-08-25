# Agent OS Telegram Plugin

Telegram input and output interfaces backed by Bot API long polling.

Use one shared adapter instance for input and output so responses are correlated
with the chat currently being handled:

```ts
import { TelegramAdapter } from "@agent-os/telegram";

const telegram = new TelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
});

await telegram.start(async (message) => {
  await telegram.write(`Received: ${message.text}`);
});
```

The same constructor is exported as `TelegramInput` and `TelegramOutput` for
interface-specific discovery. The adapter accepts text and photos, supports
`/new` to rotate the conversation session, and splits long output messages.

The plugin also exports separate React screens from `@agent-os/telegram/web/input`
and `@agent-os/telegram/web/output`. Both include editable configuration; the
input view displays polling and received-message data, while the output view
displays delivery status and recent sends.
