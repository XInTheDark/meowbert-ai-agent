---
title: Discord Connector
summary: Full setup guide for receiving and responding to tasks via a Discord bot.
---

# Discord Connector

The Discord connector lets your team trigger Meowbert tasks by sending messages in a Discord server. The bot reads messages, creates tasks, and replies in the same channel. This page covers everything from creating a Discord application to sending your first task.

---

## Prerequisites

- A Meowbert workspace where you are an **owner or admin**.
- A Discord account with permission to create applications at [discord.com/developers](https://discord.com/developers).
- Permission to add bots to the Discord server you want to use.

---

## Step 1 — Create a Discord application and bot

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.
2. Give it a name (e.g., `Meowbert`) and click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Add Bot** (or **Reset Token** if a bot already exists).
5. Under the token section, click **Copy** to copy your bot token. You'll need this in Meowbert.

> Keep this token secret. It grants full control over the bot.

6. Scroll down to **Privileged Gateway Intents** and enable:
   - **Message Content Intent** — required for the bot to read message content.
7. Click **Save Changes**.

---

## Step 2 — Invite the bot to your server

1. In the left sidebar, click **OAuth2 → URL Generator**.
2. Under **Scopes**, check: `bot`.
3. Under **Bot Permissions**, check at minimum:
   - `Read Messages / View Channels`
   - `Send Messages`
   - `Read Message History`
4. Copy the generated URL and open it in a browser.
5. Select the Discord server you want to add the bot to and click **Authorize**.

The bot will now appear in your server's member list (offline until the connector is active).

---

## Step 3 — Configure the connector in Meowbert

1. In the Meowbert sidebar, click **Connectors**.
2. Click the **Discord** tab.
3. Paste your bot token into the **Bot Token** field.
4. Choose a **connection mode**:

   | Mode | When to use |
   |---|---|
   | **Gateway** | Recommended. The bot connects to Discord's WebSocket gateway and receives messages in real time. No public URL required. |
   | **Shared** | Uses a single shared bot configured at the platform level by a super-admin. Multiple workspaces share the bot. Users still pair their own accounts. |

5. Set the **Default project** — the project that receives messages when no routing rule matches.
6. Click **Save**.

The bot should come online in your Discord server within a few seconds.

---

## Step 4 — Pair your Discord account

Pairing links your Discord user identity to your Meowbert account.

1. In the **Discord** connector tab, click **Generate pair code**.
2. A code will appear — it looks like `PAIR-XXXXXXXX`. It's valid for **10 minutes**.
3. In Discord, send that code as a direct message to the bot, or send it in a channel where the bot can see messages.
4. The connector will recognize the code and confirm pairing.

> Each workspace member needs to pair their own Discord account separately.

---

## Step 5 — Send your first task

Go to any channel where the bot has permission to read and write messages, and send a message:

```
Run a quick health check on the project and report what tools are available.
```

The bot will reply with the task output when complete.

---

## Usage patterns

### Starting a new task

Send any message in a channel where the bot is present. The routing engine picks a project based on your routing rules and creates a task.

> **Note:** The bot only processes messages from paired accounts by default. Unpaired users' messages are ignored.

### Using prefix routing

Configure prefix rules in the Routing tab to direct messages to specific projects:

```
#backend Check the database connection status.
```

If `#backend` is configured to route to your `backend-env` project, this message goes there directly.

### Continuing a conversation (threading)

Reply to the bot's message (using Discord's reply feature) to continue the same task. The system routes the reply to the existing task rather than creating a new one, enabling multi-turn conversations.

### Private DMs to the bot

You can also DM the bot directly if you prefer to keep task requests private from the channel. Pairing still applies.

---

## Channel and permission recommendations

For a clean team workflow:
- Create a dedicated `#meowbert` or `#ai-tasks` channel in your server.
- Give the bot `Read Messages`, `Send Messages`, and `Read Message History` permissions in that channel.
- Use Discord's channel permissions to control which team members can post in that channel.

---

## Advanced options

### Routing rules

Configure multi-project routing from the **Routing** tab. See [Connectors Overview](/core-workflows/connectors) for details on rule types (prefix, keyword, default, LLM fallback).

### Multiple workspaces

If you have multiple Meowbert workspaces, each can have its own Discord connector with a different bot token, or you can use **Shared mode** with a platform-level bot and route by channel or keyword.

---

## Troubleshooting

**Bot is offline in Discord:**
- Check that the bot token is correct and hasn't been regenerated since you saved it.
- Verify the worker service is running and connected (check the connector status in the UI).

**Messages aren't creating tasks:**
- Make sure your Discord account is paired.
- Confirm the bot has **Message Content Intent** enabled in the Developer Portal.
- Verify a default project is set.
- Check that the bot has permission to read messages in the channel.

**Bot responds but the task fails immediately:**
- Check that the target project is `active` and not archived.
- Review the task's Events tab for error details.

**Pair code expired:**
- Pair codes expire after 10 minutes. Generate a new one and send it promptly.

**Bot can see messages but doesn't respond:**
- Check that the bot token has `Send Messages` permission in that channel.
- Look at the worker logs for errors related to Discord message delivery.
