---
title: Telegram Connector
summary: Full setup guide for receiving and responding to tasks via a Telegram bot.
---

# Telegram Connector

The Telegram connector lets your team submit tasks to Meowbert by messaging a Telegram bot. The agent runs the task and replies in the same chat. This page walks through the complete setup from creating a bot to sending your first task.

---

## Prerequisites

- A Meowbert workspace where you are an **owner or admin**.
- A phone number registered with Telegram (to create the bot via @BotFather).
- Your Meowbert server must be reachable from the internet (for webhook mode) or be able to reach `api.telegram.org` outbound (for polling mode).

---

## Step 1 — Create a Telegram bot

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot`.
3. Follow the prompts: choose a display name and a username (must end in `bot`, e.g., `myteam_meowbert_bot`).
4. BotFather will reply with your bot's **API token** — a string that looks like `7012345678:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Copy it now.

> Keep this token secret. Anyone with the token can control your bot.

---

## Step 2 — Configure the connector in Meowbert

1. In the Meowbert sidebar, click **Connectors**.
2. Click the **Telegram** tab.
3. Paste your bot token into the **Bot Token** field.
4. Choose a **connection mode**:

   | Mode | When to use |
   |---|---|
   | **Webhook** | Recommended for production. Telegram pushes messages to your server instantly. Requires a publicly reachable HTTPS URL. |
   | **Polling** | The server polls Telegram for new messages. Works behind firewalls or without a public URL. Slightly higher latency. |
   | **Shared** | Uses a single shared bot token configured at the platform level by a super-admin. All workspaces on the platform share the bot. Users must still pair their accounts. |

5. If using **Webhook** mode: copy the webhook URL shown in the UI (it looks like `https://your-domain.com/api/connectors/telegram/<bindingId>/webhook`) — Meowbert will register this automatically with Telegram when you save.
6. Set the **Default project** — the project that receives messages when no routing rule matches.
7. Click **Save**.

After saving, the UI will confirm whether the webhook was registered successfully (webhook mode) or polling is active (polling mode).

---

## Step 3 — Pair your Telegram account

Pairing links your Telegram user identity to your Meowbert account so the system knows who is sending messages.

1. In the **Telegram** connector tab, click **Generate pair code**.
2. A code will appear — it looks like `PAIR-XXXXXXXX`. It's valid for **10 minutes**.
3. Open Telegram and send that code as a message to your bot (e.g., `/start PAIR-XXXXXXXX` or just `PAIR-XXXXXXXX`).
4. The connector will recognize the code, link your account, and confirm pairing.

Once paired, your Telegram messages are attributed to your Meowbert account and subject to your workspace access level.

> Each workspace member must pair their own Telegram account separately.

---

## Step 4 — Send your first task

Open Telegram, find your bot, and send a message describing what you want done:

```
Summarize the contents of README.md in the current project.
```

The bot will acknowledge the message and reply with the task output when it's done.

---

## Usage patterns

### Starting a new task

Simply send any message to the bot. The routing engine picks a project (based on your routing rules) and creates a new task.

### Using prefix routing

If you have multiple projects, use prefixes to target specific ones. For example, if you've configured a prefix rule `#docs` → `docs-project`:

```
#docs Update the changelog with the latest release notes.
```

### Continuing a conversation

Reply to the bot's previous message (using Telegram's reply-to feature) to continue the same task rather than starting a new one. This is how multi-turn conversations work — the agent sees the full history.

### Handling `awaiting_input`

If the agent needs clarification, it will send a message back to the chat saying it's waiting. Reply to continue the task.

---

## Advanced options

### Routing rules

Configure routing rules in the **Routing** tab of the Connectors page. See [Connectors Overview](/core-workflows/connectors) for a full explanation of rule types.

### Restricting who can use the bot

By default, only paired workspace members can trigger tasks. Unpaired messages are ignored. To further restrict access, ensure your workspace membership is locked down to the intended users.

### Webhook security

Meowbert registers Telegram webhooks with Telegram's built-in secret token support and verifies the `X-Telegram-Bot-Api-Secret-Token` header on every webhook request. The `bindingId` in the URL is no longer treated as the only secret.

---

## Troubleshooting

**Messages aren't creating tasks:**
- Check that the connector status shows **Connected** in the Telegram tab.
- Verify your account is paired (the pairing status should say "Paired").
- Confirm a default project is set.
- For webhook mode, check that the webhook URL is reachable from the internet and returns a 200 response.

**Webhook mode isn't working behind a reverse proxy:**
- Ensure your proxy passes the `X-Forwarded-For` and `Host` headers correctly.
- Ensure your proxy forwards the `X-Telegram-Bot-Api-Secret-Token` header unchanged.
- Telegram requires HTTPS — a self-signed certificate won't work. Use Let's Encrypt or similar.

**Polling mode not receiving messages:**
- Check the worker logs for Telegram polling errors.
- Verify the bot token is correct and the bot is not deleted or blocked.

**Pair code expired:**
- Pair codes are valid for 10 minutes. Generate a new one and send it before it expires.
