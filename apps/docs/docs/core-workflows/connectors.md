---
title: Connectors — Overview & Routing
summary: Link Telegram, Discord, GitHub, and Email so tasks can flow through your tools.
onboardingId: connectors
checklistLabel: Connectors
---

# Connectors — Overview & Routing

Connectors let your team submit tasks from external tools — Telegram, Discord, GitHub, and Email — without opening the Meowbert web app. When a message arrives, the routing engine decides which project it belongs to, creates a task, and replies with the result.

## Available connectors

| Connector | How it works | Best for |
|---|---|---|
| **Telegram** | A Telegram bot receives messages and creates tasks. Supports webhook, polling, and shared-bot modes. | Small teams, mobile-first workflows, personal automation. |
| **Discord** | A Discord bot listens in a server and creates tasks from messages. Supports gateway and shared-bot modes. | Development teams already on Discord. |
| **GitHub** | A GitHub App listens to issue/PR comments mentioning the app. Creates tasks from matching comments. | Code review, automated PR assistance, repo automation. |
| **Email** | Brevo inbound parsing forwards emails to Meowbert. Workspace addresses create/continue tasks and replies are sent by email. | Ticket-style workflows, external request intake, vendor/client email ops. |

## Setting up a connector

Each connector has its own setup guide:

- [Telegram Setup Guide](/core-workflows/connectors-telegram)
- [Discord Setup Guide](/core-workflows/connectors-discord)
- [GitHub Setup Guide](/core-workflows/connectors-github)
- [Email Connector (Workspace Usage)](/core-workflows/connectors-email)
- [Email Inbound Admin Setup](/core-workflows/connectors-email-inbound-admin)

## The routing engine

When a message arrives from any connector, Meowbert must decide which project to route it to. The routing engine evaluates rules in priority order:

### Rule types

| Rule type | How it works |
|---|---|
| **Default project** | A fallback rule that always routes to a specific project when no other rule matches. |
| **Prefix match** | Routes messages that start with a specific string (e.g., `#data `) to a designated project. |
| **Keyword map** | Routes messages containing specific keywords to a designated project. |
| **LLM fallback** | Uses the main model to read the message and pick the best project from a list. Slower but intelligent. |

### Configuring routing rules

1. Go to **Connectors** in the sidebar.
2. Open the **Routing** tab (or scroll to the routing section).
3. Add rules by selecting the type, project, and matching criteria.
4. Set priorities — lower number = higher priority. The first matching rule wins.

**Recommended setup for most teams:**
- Create a **Default project** rule pointing to your main working project. This ensures every message gets routed somewhere even if no other rule matches.
- Add **Prefix rules** for specialized projects (e.g., `#docs ` → `docs-project`).

### Conversation threading

Connectors support **conversation threading** — if a message is a reply to an earlier message that started a task, the follow-up is routed to the same task rather than creating a new one. This lets you have back-and-forth with the agent directly inside Telegram, Discord, or GitHub.

## Access control

- Only **workspace owners and admins** can configure connectors.
- Any **workspace member** can pair their account and send messages through a configured connector.
- GitHub App setup requires a GitHub organization owner or account with sufficient App management permissions.

## General tips

- Always set a **default project** before testing connectors. Without a fallback, messages that don't match any rule will be rejected.
- Test with a simple message before rolling out to the full team.
- Review routing rules periodically — as you add projects, you may want more specific routing.
- For GitHub, ensure the App has the correct webhook events enabled (`issue_comment`, `pull_request_review_comment`).
