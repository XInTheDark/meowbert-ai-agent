---
title: Email Connector (Admin Inbound Setup)
summary: Step-by-step guide for server admins to enable inbound email task creation.
---

# Email Connector (Admin Inbound Setup)

This guide is for **server admins** who need to set up inbound email for all workspaces.

If you are a workspace owner (not server admin), jump to **Step 6** after your admin finishes **Steps 1-5**.

---

## How email flow works in Meowbert

1. Someone sends an email to a workspace address (for example, `ops@inbound.example.com`).
2. Brevo posts that inbound message to Meowbert webhook endpoint.
3. Meowbert validates sender policy, routes to a task/project, and saves attachments into the project filesystem.
4. When the task finishes, Meowbert sends a reply email (via Listmonk) with the task result and a direct task link.

---

## Prerequisites (before touching the UI)

Make sure all of these are true first:

- `connectors.email.enabled` is set to `true` in your server config.
- API is publicly reachable over HTTPS (Brevo must call it from the internet).
- `server.publicUrl` points to that same public HTTPS API base URL (not `localhost`).
- You control an email domain/subdomain for inbound mail (for example `inbound.example.com`).
- Outgoing email is set up (see [Outgoing Email](/reference/email-delivery)). It sends the completion replies.

### Required config flag

In `config/global.json` (or your deploy config), ensure:

```json
{
  "connectors": {
    "email": {
      "enabled": true
    }
  }
}
```

Then restart API + worker.

---

## Step 1 — Choose and prepare your inbound domain

Pick a dedicated inbound domain/subdomain, for example:

- `inbound.example.com` (recommended)
- `mail-in.example.com`

Using a dedicated inbound domain avoids conflicts with normal corporate mail routing.

---

## Step 2 — Configure inbound domain in Brevo

In Brevo, set up inbound parsing for your chosen domain.

1. Open Brevo inbound/parsing settings.
2. Add your inbound domain (for example `inbound.example.com`).
3. Add the DNS records Brevo asks for (typically MX/TXT).
4. Wait until Brevo shows the domain as verified/active.

> Brevo can change required DNS targets over time, so always follow the exact values shown in your Brevo dashboard.

---

## Step 3 — Create the Meowbert inbound webhook URL

In Meowbert:

1. Go to **Admin -> Connectors**.
2. Find **Email Inbound (Brevo)**.
3. Enter a long random **Webhook token** (32+ chars).
4. The panel will show **Generated inbound endpoint** automatically.
5. Click **Copy Endpoint** to copy the exact URL for Brevo.

You can still build this URL manually if needed:

```text
https://<your-public-api-domain>/api/connectors/email/inbound/brevo?token=<your_webhook_secret>
```

> The generated URL is built from `server.publicUrl`. If that is set to `https://localhost:4000` or a private/internal host, Brevo will not be able to deliver inbound emails.

---

## Step 4 — Configure Email Inbound in Meowbert admin UI

In Meowbert:

1. In **Admin -> Connectors -> Email Inbound (Brevo)**, set:
   - **Enable email inbound webhook**: ON
   - **Inbound domain**: your inbound domain (for example `inbound.example.com`)
   - **Workspace address mode**:
     - `Random local-part`: Meowbert assigns addresses automatically
     - `Workspace custom local-part`: owners choose addresses like `ops`, `alerts`, `support`
   - **Webhook token**: same token used in generated inbound endpoint
   - **Brevo API key**: Brevo API key with inbound attachment access
2. Click **Save Email Inbound Settings**.

If saved correctly, the panel should show webhook secret and Brevo API key as configured.

---

## Step 5 — Configure Brevo webhook target

Use Meowbert to sync the webhook automatically:

1. In **Admin -> Connectors -> Email Inbound (Brevo)**, click **Auto-create Brevo Webhook**.
2. Meowbert will create or update Brevo inbound webhook config for your inbound domain.
3. Confirm success message and webhook ID in the UI.

Manual fallback (if needed):

1. Open Brevo inbound webhook settings.
2. Set target URL to the generated endpoint from Step 3.
3. Ensure inbound payload delivery is enabled.
4. Send a test inbound event from Brevo (if available).

At this point, platform-level inbound is ready.

---

## Step 6 — Workspace owner setup (per workspace)

For each workspace:

1. Open **Connectors -> Email**.
2. Click **Connect Email**.
3. Configure:
   - **Local-part** (if admin enabled custom mode)
   - **Sender policy**:
     - `Allow any incoming sender` (faster setup, less safe)
     - `Only allow trusted addresses` (recommended)
   - **Trusted addresses** (comma-separated, if trusted-only mode)
   - **Default project** (fallback route)
   - Optional advanced routing flags (prefix/keyword/LLM fallback)
4. Save.

You should now see the workspace email address (for example `ops@inbound.example.com`).

---

## Step 7 — End-to-end smoke test

Run this exact test:

1. Send an email from a permitted sender to workspace address.
2. Include subject + body and attach a small file.
3. Verify in Meowbert:
   - A new task is created (or active task continued).
   - Message source is email.
   - Attachment path appears under project root, e.g. `/incoming/email/<date>/<message-id>/...`.
4. Wait for task completion.
5. Verify reply email arrives with:
   - task output
   - direct task link (`/app/<workspace>/projects/<env>/tasks/<taskId>`)

---

## Security checklist (recommended)

- Use `trusted_only` sender policy for production workspaces.
- Keep webhook token long and random; rotate if leaked.
- Use a dedicated inbound domain/subdomain.
- Keep Brevo API key scoped and stored only in admin connector settings.
- Monitor inbound volume for abuse/spam.

---

## Quick troubleshooting

### No task appears after sending email

Check in this order:

1. `connectors.email.enabled` is true and services restarted.
2. Admin Email Inbound is enabled and domain is set.
3. Brevo webhook points to `/api/connectors/email/inbound/brevo?token=...`.
4. Webhook token in Brevo URL exactly matches Meowbert admin token.
5. Workspace email connector is connected.
6. Sender is allowed by sender policy.

### Brevo webhook sync fails in admin panel

- Confirm `server.publicUrl` is a public HTTPS URL (not localhost/private host).
- Confirm inbound domain in Meowbert exactly matches the domain configured in Brevo.
- Confirm Brevo API key is valid and has access to webhook APIs.
- If auto-sync still fails, use manual fallback in Step 5 and check API logs for the exact Brevo response.

### Tasks create, but no completion email reply

- Confirm Listmonk provider is enabled in **Admin -> Connectors**.
- Confirm email templates are synced and `task_result` template exists.
- Check worker logs for `email_outbox` delivery failures.

### Attachments missing

- Confirm Brevo API key is configured in admin email inbound settings.
- Check API logs for attachment download errors.
