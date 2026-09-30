---
title: Email Connector
summary: Use your workspace email address to create tasks, share files, and get replies in your inbox.
---

# Email Connector

The Email connector lets you run Meowbert from your inbox. Send an email to your workspace address, and Meowbert creates a task, processes attachments, and replies when it is done.

---

## Before you start

- You are a workspace **owner or admin** (required to configure workspace email connector settings).
- Server admin has completed inbound setup in [Email Inbound Admin Setup](/core-workflows/connectors-email-inbound-admin).

If the Email tab says inbound is not available, ask your server admin to enable it first.

---

## Step 1 — Connect email in your workspace

1. Open **Connectors** in the sidebar.
2. Open the **Email** tab.
3. Click **Connect Email**.
4. Configure:
   - **Local-part** (only shown if your admin allows custom addresses)
   - **Sender policy**:
     - `Allow any incoming sender` (quick setup, less strict)
     - `Only allow trusted addresses` (recommended)
   - **Trusted addresses** as a comma-separated list (if trusted-only mode is selected)
   - **Default project** (fallback target when no routing rule matches)
5. Save.

After saving, the connector shows your workspace email address (for example `ops@inbound.example.com`).

---

## Step 2 — Send your first task by email

Send an email to your workspace address with a clear subject/body, for example:

```text
Subject: Summarize new incident report
Body: Please summarize the attached PDF and list action items for today.
```

Meowbert creates a task in your workspace and routes it using your connector routing rules.

---

## Step 3 — Continue threads and receive replies

- Reply to a previous Meowbert email thread to continue the same task.
- Start a fresh email thread to create a new task.
- When a task finishes, Meowbert sends a reply email with:
  - task result summary
  - direct link to open the task in Meowbert

---

## Attachments and files

Email attachments are downloaded and saved into the project filesystem under incoming email paths.

That means they are available to:
- the running task
- the Files browser in the web app
- later follow-up prompts in the same project

---

## Routing behavior

Email uses the same routing behavior as Telegram and Discord:

- Default project fallback
- Prefix rules
- Keyword rules
- LLM fallback routing

See [Connectors — Overview & Routing](/core-workflows/connectors) for routing strategy details.

---

## Troubleshooting

**No workspace email address appears:**
- Confirm the connector is connected and saved.
- If inbound is unavailable, ask server admin to finish admin-side setup.

**Emails are ignored:**
- Check sender policy.
- In trusted-only mode, confirm your sender address is listed.
- Verify a default project is set.

**No completion email reply:**
- Ask your server admin to check outbound provider (Listmonk) and delivery logs.

**Attachments are missing in task context:**
- Check Files browser under incoming email folders in the target project.
- Ask server admin to verify Brevo API key is configured for inbound attachment fetch.
