# PLAIOS Pattern Predictor

An input that learns time-of-day habits from the chat history and asks the user before the usual time, for example "Vuoi che spenga la luce?" a few minutes before midnight.

- Every night (`analysisCron`) System 2 groups the user's last 21 days of messages by intent. Code then keeps the groups seen on at least 3 different days within ±30 minutes of the same time.
- Each prediction is stored by key, so a habit is tracked once. Dismissed or promoted ones are never asked again, and 3 unanswered questions in a row mute it.
- At the usual time minus `leadMinutes`, the question enters the normal pipeline as a proactive message and goes to `outputChannel`. The user's "sì" is handled by the agent as a normal reply.
- Groups are concrete actions ("spegni la luce") or recurring activities ("idee per i video TikTok").
- `predictions.manage` lets the agent list, add, remove, check ("did you notice X?"), dismiss, resume, promote (after creating a cronjob) or re-analyse.

```yaml
- package: "@plaios/pattern-predictor"
  version: 0.1.2
  interface: pattern-predictor.input
  instanceId: input:pattern-predictor
  config:
    outputChannel: telegram
    userId: thomas
```
