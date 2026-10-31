# @plaios/email

Watches your mailboxes and tells you about the emails that matter.

- **Mailboxes**: Gmail, Outlook and any IMAP server, as many as you like. Add them from the component page; the login is tested before saving and passwords or tokens are stored encrypted (AES-256-GCM with `SECRETS_KEY`) in the database, never shown again.
- **Live**: IMAP IDLE, so each email is handled as it arrives. A new mailbox starts from now; old mail is not replayed.
- **Sorting**: the fast model (System 1) picks a category and scores importance. Tune it with `importanceRules` ("anything from my accountant").
- **Important emails** (above `threshold`, default 0.7) are saved to memory and handed to the agent, which writes you a short notification on `outputChannel` (for example `telegram`).
- **Tool**: `read_email` lets the agent list recent emails by importance, category or sender.

## Credentials
- **Gmail**: turn on 2-step verification, then Google account → Security → App passwords. Or OAuth2 with your own Google Cloud client and a refresh token for `https://mail.google.com/`.
- **Outlook / Microsoft 365**: Microsoft has turned off passwords for IMAP, so use OAuth2: an Azure app registration (client id, and secret if it has one) and a refresh token with `IMAP.AccessAsUser.All offline_access`.
- **Other IMAP**: server, port (993) and password.
