---
title: Outgoing Email (Admin Setup)
summary: Turn on optional outgoing email for sign-up verification, password resets, and email task replies.
---

# Outgoing Email (Admin Setup)

Meowbert works without email. Outgoing email is optional and off by default. Turn it on if you want:

- **Sign-up verification codes** for new users
- **Password reset** links
- **Task result replies** for the [Email connector](/core-workflows/connectors-email)
- **Announcements** sent to your users

Meowbert sends email through [Listmonk](https://listmonk.app), a self-hosted mail manager. Listmonk delivers the messages through any SMTP server you already use, such as your email provider, Amazon SES, or Postmark.

## 1. Start Listmonk

Listmonk and its database are in the Docker Compose file behind the `email` profile, so a normal `docker compose up` doesn't start them. Start the stack with the profile:

```bash
docker compose --profile email up -d
```

Listmonk is then available at `http://localhost:9000`. Sign in with the admin user from `LISTMONK_ADMIN_USER` and `LISTMONK_ADMIN_PASSWORD` (both default to `listmonk`, so change them in your `.env` before exposing the server).

## 2. Configure Listmonk

In the Listmonk admin:

1. Open **Settings → SMTP** and add your SMTP server. Use **Test connection** to confirm it works.
2. Open **Settings → General** and set the **Default "from" email**.
3. Open **Admin → Users** and create an **API** user (for example `meowbert_api`). Copy its token.

## 3. Enable email in Meowbert

Set `email.enabled` to `true` in your server config (`config/global.json` or `config/global.docker.json`), and point `email.appBaseUrl` at the address people use to open Meowbert:

```json
{
  "email": {
    "enabled": true,
    "appBaseUrl": "https://meowbert.example.com"
  }
}
```

Restart the API and worker.

## 4. Connect Listmonk

In Meowbert, open **Admin → Connectors → Listmonk Email Provider**:

- **Listmonk base URL**: `http://listmonk:9000` (the Compose service name)
- **API username** and **API token**: the API user from step 2

Turn the provider on and save. Meowbert creates its email templates in Listmonk automatically.

## 5. Turn on the features you want

In **Admin → Settings**, you can now enable:

- **Require email verification on sign-up**
- **Forgot password**

Both are off by default because they need working email.

## Troubleshooting

- **"Email is disabled in server config"** when saving the provider: `email.enabled` is still `false`, or the API wasn't restarted.
- **No emails arrive:** check **Settings → Logs** in Listmonk. Most delivery problems are SMTP credentials or a "from" address your SMTP server doesn't allow.
