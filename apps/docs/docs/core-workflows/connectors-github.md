---
title: GitHub Connector
summary: Full setup guide for triggering Meowbert tasks from GitHub issue and PR comments.
---

# GitHub Connector

The GitHub connector lets Meowbert respond to comments on GitHub issues and pull requests. When someone mentions the bot in a comment, Meowbert creates a task, runs it, and replies in the same thread. This page covers creating the GitHub App, configuring credentials, installing it on your repository or organization, and triggering your first task.

---

## Prerequisites

- A Meowbert workspace where you are an **owner or admin**.
- A GitHub account with permission to create GitHub Apps (account owner or organization owner for org-level apps).
- Your Meowbert server must be reachable from the internet — GitHub will push webhook events to it.
- `github.enabled` must be set to `true` in your Meowbert config (`config/global.json` or `config/global.docker.json`).

---

## Step 1 — Enable the GitHub connector in config

Open your config file and set:

```json
{
  "github": {
    "enabled": true
  }
}
```

Restart the API and worker after making this change. The **GitHub** tab will now appear in the Connectors page.

---

## Step 2 — Create a GitHub App

GitHub Apps are the recommended way to integrate with GitHub. They have scoped permissions and can be installed on specific repositories.

1. Go to [https://github.com/settings/apps](https://github.com/settings/apps) (for a personal app) or `https://github.com/organizations/<org>/settings/apps` (for an org-level app).
2. Click **New GitHub App**.
3. Fill in the required fields:

   **App name:** Choose something descriptive like `Meowbert Bot` or `meowbert-yourteam`.

   **Homepage URL:** Your Meowbert server URL (e.g., `https://meowbert.yourcompany.com`).

   **Webhook URL:** This is the centralized webhook endpoint shown in the Connectors → GitHub tab in Meowbert:
   ```
   https://your-domain.com/api/connectors/github/webhook
   ```
   Copy this exact URL from the UI before creating the App.

   **Webhook secret:** Generate a strong random string and paste it here. You'll also enter it in Meowbert. Keep it safe.

4. Under **Repository permissions**, grant:
   - **Issues** → Read & Write (to read issue comments and post replies).
   - **Pull requests** → Read & Write (to read PR review comments and post replies).
   - **Contents** → Read & Write (so tasks can clone, fetch, commit, and push private repositories).

5. Under **Subscribe to events**, check:
   - **Issue comment**
   - **Pull request review comment**

6. Under **Where can this GitHub App be installed?**, choose:
   - **Any account** — if you want to allow installation on any GitHub account or org.
   - **Only on this account** — if it's just for your own repos/org.

7. Click **Create GitHub App**.

8. After creation, note your **App ID** (shown at the top of the App settings page).

9. Scroll down to **Private keys** and click **Generate a private key**. GitHub will download a `.pem` file — open it and copy all the contents (including the `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines).

---

## Step 3 — Configure the connector in Meowbert

1. In the Meowbert sidebar, click **Connectors** → **GitHub** tab.
2. You'll see a form to enter your GitHub App credentials. Click **Configure App** or the edit icon.
3. Fill in:

   | Field | Value |
   |---|---|
   | **App ID** | The numeric App ID from GitHub (e.g., `123456`). |
   | **App Slug** | The URL-friendly name of the app (e.g., `meowbert-bot`). This is the name used in `@meowbert-bot` mentions. |
   | **Private Key (PEM)** | Paste the full contents of the `.pem` file you downloaded. |
   | **Webhook Secret** | The same secret string you set in the GitHub App webhook configuration. |
   | **Client ID** *(optional)* | The OAuth Client ID — only needed if you're using GitHub OAuth login flows. |
   | **Client Secret** *(optional)* | The OAuth Client Secret. |
   | **Default Org** *(optional)* | A default GitHub organization name used for `git`/`gh` auth in tasks. |

4. Click **Save**.

The connector will validate the credentials and show a success or error status.

---

## Step 4 — Install the App on a repository or organization

1. In the GitHub tab of the Connectors page, click **Connect & Install**.
2. You'll be redirected to GitHub to choose where to install the App.
3. Select the organization or account, then choose **All repositories** or specific repositories.
4. Click **Install**.
5. GitHub redirects back to Meowbert, where the connector now shows the installation details (account name, installation ID, connected-at timestamp).

> You can install the same App on multiple repositories/orgs. All of them will route to this workspace.

---

## Step 5 — Set the default project and routing rules

1. In the Connectors → GitHub tab, set the **Default project** — this is where tasks from GitHub comments are created when no other rule matches.
2. Optionally, add routing rules to send comments from specific repositories or with specific keywords to different projects. See [Connectors Overview](/core-workflows/connectors) for routing rule types.

---

## Step 6 — Trigger your first task

Go to any issue or pull request in a repository where the App is installed. Write a comment that **mentions the app's bot login**:

```
@meowbert-bot Can you summarize what changes were made in this PR?
```

Replace `meowbert-bot` with your app's actual slug. Meowbert will:
1. Receive the webhook event.
2. Match the comment to a workspace via the installation ID.
3. Route it to the configured project.
4. Create a task with the comment as the prompt.
5. Reply in the GitHub thread with the result.

> The app's bot username ends in `[bot]` in GitHub (e.g., `meowbert-bot[bot]`), but you can mention it with or without the `[bot]` suffix — both work.

---

## Git and `gh` authentication in tasks

When a task runs in response to a GitHub event, Meowbert can automatically configure `git` and the GitHub CLI (`gh`) inside the task project using an **installation token** derived from your App's private key. This means the agent can:

- Clone or push to repositories the App has access to.
- Create comments, labels, or PRs using `gh`.
- Fetch repository contents programmatically.

If private repo commands return `Repository not found` even after selecting **All repositories** during installation, check the App's **Contents** permission. Repository selection and repository permissions are separate in GitHub Apps.

This happens automatically — no manual token setup is needed in the task.

---

## Usage patterns

### Asking for a PR review summary

```
@meowbert-bot Summarize the changes in this PR and identify any potential issues.
```

### Running a check on the codebase

```
@meowbert-bot Check if there are any TODO comments left in the files changed in this PR.
```

### Generating documentation

```
@meowbert-bot Generate a changelog entry for this PR based on the diff.
```

### Continuing a conversation

Reply to the bot's comment in the thread to continue the same task. The system detects that your message is a reply to an existing Meowbert task thread and routes it as a follow-up rather than a new task.

---

## Troubleshooting

**GitHub tab doesn't appear in Connectors:**
- Make sure `github.enabled` is set to `true` in your config and the API has been restarted.

**Webhook events aren't arriving:**
- Verify the webhook URL in GitHub matches exactly what Meowbert shows in the Connectors UI.
- Check that your server is publicly reachable at that URL.
- In GitHub App settings, go to **Advanced → Recent Deliveries** to see if webhooks are being delivered and what response code they got.

**Comments aren't triggering tasks:**
- Confirm the comment mentions the app's bot login (`@your-app-slug` or `@your-app-slug[bot]`).
- Check that the App is installed on the repository where the comment was posted.
- Verify a default project is set in the connector config.
- Check the webhook events subscribed — `issue_comment` and `pull_request_review_comment` must be enabled.

**`git` auth isn't working in tasks:**
- Confirm the private key PEM is saved correctly (full content including header/footer lines).
- Verify the App has **Read & Write** access to the **Contents** permission if the task needs to push changes.

**Installation shows "not installed" after completing the OAuth flow:**
- Check the GitHub App settings page to confirm the installation exists.
- Try clicking **Connect & Install** again — sometimes the callback redirect takes a moment to process.

**Webhook signature validation fails:**
- Ensure the webhook secret in GitHub matches exactly what's saved in Meowbert (case-sensitive, no trailing spaces).
