---
title: Sources (Admin Setup)
summary: Configure Google Drive, OneDrive, pCloud, rclone, Outlook, and YouTube so workspaces can use shared source content safely in tasks.
---

# Sources (Admin Setup)

This guide is for **server admins** who want to enable workspace-level sources in Meowbert.

Meowbert currently supports:

- **Google Drive**
- **OneDrive**
- **pCloud**
- **rclone**
- **Outlook**
- **YouTube**

Once a provider is configured by a server admin, each workspace owner can connect **one shared account per provider** from **Connectors → Sources** when the provider requires workspace auth. After that, every workspace member can:

- enable that source for a task from the **Sources** button in the composer,
- let the agent search or browse it during the run,
- or, for file-based sources, attach files from it through the **Attach files** menu.

Imported source files are copied into the task's local `inputs/` folder by default, so they behave like normal task attachments after import. For **Google Drive**, **OneDrive**, **pCloud**, and **rclone**, users can also choose **Live sync**, which still creates a local working copy in `inputs/` but keeps it linked to the same remote item for manual pull/push. Native Google Docs, Sheets, and Slides can instead be attached directly so the agent edits the original shared file. For **Outlook**, Meowbert exposes mailbox and calendar tools instead of file attachments. For **YouTube**, Meowbert attaches a compact metadata note from the video link instead of downloading the video itself.

---

## How the flow works

There are up to two separate setup layers:

### 1. Server admin setup

Server admins open **Admin → Sources** and enable the providers they want to offer. For Google Drive, OneDrive, pCloud, and Outlook, this is also where the OAuth app credentials are saved. rclone only needs to be enabled by an admin; the workspace owner provides the rclone remote config later.

### 2. Workspace connection

Workspace owners open **Connectors → Sources** and connect the actual Google Drive, OneDrive, pCloud, Outlook, or rclone remote that the workspace should share.

YouTube does **not** need a workspace connection step. rclone does not use OAuth; workspace owners paste an `rclone.conf`, remote name, and optional base directory instead.

That means:

- credentials are configured once at the platform level,
- connections are made per workspace when needed,
- and task-time access is shared across the workspace.

---

## What users get after setup

After a workspace source is connected:

- the composer shows a **Sources** button next to **Tools**,
- file-based sources also appear in the **Attach files** menu,
- source tools become available to the agent when that source is enabled for the task.

For **Google Drive**, **OneDrive**, **pCloud**, and **rclone** connections with write access:

- the file picker offers **Copy** and **Live sync** when attaching files,
- **Live sync** can also link folders,
- live-synced items still land in the task as local working copies,
- and the Files browser can later **Pull**, **Push**, or **Unlink** those linked items.

Google Drive and OneDrive linked items can also open the remote file or folder in the provider's web app when the provider exposes a web URL. rclone and pCloud live-sync items do not expose a generic web-open link.

For **Outlook**:

- the **Sources** button can enable Outlook for a task,
- the agent can search and read mailbox emails,
- the agent can list calendars, search events, or view a date range,
- and calendar writes are guarded so event edits use the latest Outlook version and attendee-affecting changes require explicit confirmation.

For **YouTube**:

- the same **Sources** button can enable the YouTube source for a task,
- the **Attach files** menu lets users paste a YouTube link,
- the task receives a metadata summary for that video as attached context.

For Google Workspace native files, Meowbert exports them automatically when importing, fetching, or pulling:

- **Google Docs → `.docx`**
- **Google Sheets → `.xlsx`**
- **Google Slides → `.pptx`**

When users attach a native Google file with **Live sync**, Meowbert asks for confirmation because the local working copy is an exported Office file. Pull and push are supported, but comments, formatting, and some native Google Workspace features may not round-trip perfectly when the edited Office file is pushed back to Google Drive.

When a user selects a native Google file in the attachment picker, Meowbert also offers **Attach Google files directly** as an Experimental alternative. This creates a reference to the original file, adds it to the Project's persistent Google Workspace allowlist, and automatically enables the `google-workspace` skill for tasks in that Project. Direct attachments are available only for Google Drive connections with write access. They modify the original file immediately and therefore do not show Live sync Pull or Push controls.

Live Google Drive folders also make their native Google files available to the Google Workspace skill. These appear as lightweight `.url` links in the mounted folder. The agent can read or edit the original through its link, or export an Office copy when needed, without downloading the entire folder. Folder access is checked when a tool is used; moving a file outside the attached folders or detaching the folder removes that access unless the file was also attached directly.

Connecting Google Drive alone does not make every file in the account directly editable, and copying a pointer or link from another Project does not grant access.

---

## Prerequisites

Before setting up these sources, make sure:

- your Meowbert API is reachable from the public internet over **HTTPS**,
- `server.publicUrl` points to that public API base URL,
- your deployment uses a stable `skills.rootDir` that includes the bundled `google-drive`, `google-workspace`, `onedrive`, `pcloud`, `rclone`, and `outlook` manifests.
- the API server or container has `rclone` available on `PATH`.

### Recommended URL config

```json
{
  "server": {
    "publicUrl": "https://api.example.com",
    "internalUrl": "http://meowbert-api:4000"
  }
}
```

Use `server.publicUrl` for OAuth callbacks from Google, Microsoft, and pCloud.

If your task sandboxes or worker containers cannot reliably reach that public URL from inside the runtime, set `server.internalUrl` to an internal API base URL that **is** reachable from the worker/sandbox network. This helps task-time source tools talk back to the Meowbert API.

> If `server.publicUrl` is still set to `localhost`, a private hostname, or a non-HTTPS URL, the OAuth setup will fail.

---

## Step 1 — Configure Google Drive

### What Meowbert needs

Meowbert uses a standard OAuth web application flow and requests the Drive scope:

```text
https://www.googleapis.com/auth/drive
```

This allows workspace-level search, browse, import, and live-sync pull/push for files the connected account can access.

### Google setup checklist

1. Create or select a Google Cloud project.
2. Enable the **Google Drive API**, **Google Docs API**, **Google Sheets API**, and **Google Slides API** for that project.
3. Configure the OAuth consent screen for your organization/app.
4. Create an **OAuth client ID** for a **Web application**.
5. Add this redirect URI exactly:

```text
https://<your-public-api-domain>/api/sources/oauth/google-drive/callback
```

6. Copy the **client ID** and **client secret** into **Admin → Sources → Google Drive**.
7. Turn **Enable Google Drive** on and save.

### Notes

- The redirect URI must match **exactly**.
- If you change domains later, update both Google Cloud and Meowbert.
- If users see Google consent errors, double-check the required Google APIs are enabled and the consent screen is published/configured for the right audience.

---

## Step 2 — Configure OneDrive

### What Meowbert needs

Meowbert uses Microsoft identity platform OAuth and requests delegated Microsoft Graph permissions equivalent to:

- `Files.ReadWrite`
- `offline_access`
- `User.Read`

### Microsoft setup checklist

1. Create or open an app registration in Microsoft Entra / Azure AD.
2. Choose supported account types that match your rollout.
   - If you want both work/school accounts and personal Microsoft accounts, use a setting compatible with **organizational directories and personal Microsoft accounts**.
3. Add a **Web** redirect URI:

```text
https://<your-public-api-domain>/api/sources/oauth/onedrive/callback
```

4. Add delegated Microsoft Graph permissions for:
   - `Files.ReadWrite`
   - `offline_access`
   - `User.Read`
5. Create a **client secret**.
6. Copy the **application (client) ID** and **client secret** into **Admin → Sources → OneDrive**.
7. Turn **Enable OneDrive** on and save.

### Notes

- Some Microsoft tenants require an admin to grant consent before users can connect.
- If you only want internal company accounts, you can use a narrower account-type setting, but it needs to stay compatible with the way your users sign in.
- OneDrive **Live sync** depends on write access. Existing workspace connections may need a **Reconnect** from **Connectors → Sources** before the new option appears.

---

## Step 3 — Configure pCloud

### What Meowbert needs

Meowbert uses pCloud's OAuth code flow. pCloud returns the API hostname for the connected account during OAuth, and Meowbert stores that hostname so future calls use the correct pCloud data center.

### pCloud setup checklist

1. Create or open a pCloud developer app.
2. Add this redirect URI exactly:

```text
https://<your-public-api-domain>/api/sources/oauth/pcloud/callback
```

3. Copy the app's **client ID** and **client secret** into **Admin → Sources → pCloud**.
4. Turn **Enable pCloud** on and save.

### Notes

- The redirect URI must match **exactly**.
- pCloud search in Meowbert matches file and folder names/paths. pCloud does not expose a Google Drive-style indexed full-text search endpoint in its documented API.
- pCloud's documented OAuth code flow does not return refresh tokens. If a workspace connection stops working, reconnect the pCloud source from **Connectors → Sources**.
- pCloud live sync supports pull/push for linked files and folders, but pCloud does not provide the same private web-view URL metadata used by Google Drive and OneDrive for **Open remote** links.

---

## Step 4 — Configure Outlook

### What Meowbert needs

Meowbert uses Microsoft identity platform OAuth and requests delegated Microsoft Graph permissions equivalent to:

- `Mail.Read`
- `Calendars.ReadWrite`
- `offline_access`
- `User.Read`

This allows the connected workspace account to search and read mail, inspect calendars, and safely create or update calendar events.

### Microsoft setup checklist

1. Create or open an app registration in Microsoft Entra / Azure AD.
2. Choose supported account types that match your rollout.
   - If you want both work/school accounts and personal Microsoft accounts, use a setting compatible with **organizational directories and personal Microsoft accounts**.
3. Add a **Web** redirect URI:

```text
https://<your-public-api-domain>/api/sources/oauth/outlook/callback
```

4. Add delegated Microsoft Graph permissions for:
   - `Mail.Read`
   - `Calendars.ReadWrite`
   - `offline_access`
   - `User.Read`
5. Create a **client secret**.
6. Copy the **application (client) ID** and **client secret** into **Admin → Sources → Outlook**.
7. Turn **Enable Outlook** on and save.

### Notes

- Some Microsoft tenants require an admin to grant consent before users can connect.
- Outlook calendar write support depends on `Calendars.ReadWrite`.
- Outlook tools do not add a file picker; users enable Outlook from the **Sources** button in the task composer instead.

---

## Step 5 — Enable rclone

rclone is different from the OAuth providers. The server admin only enables the source; each workspace owner provides the actual rclone remote config.

In **Admin → Sources**:

1. find **rclone**,
2. turn it on,
3. save.

The API server runs the installed `rclone` binary directly. The bundled API Docker image installs rclone during image build; custom host or container deployments must install rclone separately and make it available on `PATH`.

Workspace owners then open **Connectors → Sources → rclone** and provide:

- the contents of `rclone.conf`,
- the remote name, matching a section in that config,
- an optional base directory that limits browsing and searching to a subfolder or bucket prefix.

### Notes

- rclone search in Meowbert matches file and folder names/paths by recursively listing the configured base directory.
- rclone does not provide a generic web URL for **Open remote** links.
- Live sync uses the best hash exposed by the rclone backend. If a backend does not expose hashes, Meowbert falls back to size and modified time for change detection.
- rclone item IDs are paths relative to the configured base directory. If a remote item is renamed or moved outside Meowbert, old live-sync links point at the old path.

---

## Step 6 — Save provider credentials in Meowbert

In **Admin → Sources**:

1. open the provider card,
2. paste the client ID,
3. paste the client secret,
4. enable the provider,
5. save.

You should see the provider marked as configured afterward.

---

## Step 7 — Enable YouTube

YouTube is simpler:

1. open **Admin → Sources**,
2. find **YouTube**,
3. turn it on,
4. save.

There is no OAuth client ID, no client secret, and no workspace account connection for YouTube.

When enabled, users can:

- enable the YouTube source from the **Sources** button,
- attach a YouTube link from the **Attach files** menu,
- let the agent use the bundled `yt-dlp` tooling inside source-enabled runs when needed.

---

## Step 8 — Connect a workspace account

For each workspace:

1. open **Connectors → Sources**,
2. choose **Connect** for Google Drive, OneDrive, pCloud, or Outlook,
3. complete the provider OAuth flow in the browser,
4. return to Meowbert.

For rclone, paste the workspace's `rclone.conf`, remote name, and optional base directory in the rclone source card instead of using OAuth.

In v1, each workspace can connect:

- **one Google Drive account**
- **one OneDrive account**
- **one pCloud account**
- **one rclone remote**
- **one Outlook account**

The connection is shared across the workspace.


## Step 9 — Smoke test the feature

Use this quick end-to-end check:

1. Open a task composer in that workspace.
2. Confirm the **Sources** button appears next to **Tools**.
3. Enable the source you want to test.
4. If you are testing a file or link source, open **Attach files** and choose the source.
5. For **Google Drive**: select a native Google Doc, Sheet, or Slides presentation and confirm the Office conversion or direct attachment choice appears. Also test a regular file or folder with **Copy** or **Live sync**.
6. For **OneDrive**: search for a file or folder, then choose **Copy** or **Live sync**.
7. For **pCloud**: search for a file or folder, then choose **Copy** or **Live sync**.
8. For **rclone**: browse or search for a file or folder, then choose **Copy** or **Live sync**.
9. For **Outlook**: enable the source, then ask the agent to search recent email or inspect the calendar.
10. For **YouTube**: paste a video link and attach it.
11. Send a task that references the attached context.

For Google Drive, OneDrive, pCloud, and rclone in **Copy** mode, you should see the imported file land in the task's `inputs/` folder and behave like a normal attachment.

For Google Drive, OneDrive, pCloud, or rclone in **Live sync** mode, you should see the file or folder land in `inputs/`, show a **Live** badge in the Files browser, and offer **Pull** / **Push** actions from the preview pane.

For a directly attached Google Doc, Sheet, or Slides presentation, you should see a reference attachment instead of an Office working copy. The current task and a second task in the same Project should both be able to read the original Google file, and the attachment should not offer Live sync Pull or Push controls. A task in another Project must not gain access by copying the pointer file. On a Google Drive connection without write access, the direct option should be disabled.

For Outlook, the task should be able to search mailbox email, read a specific message, and inspect or safely edit calendar events without using the file picker.

For YouTube, you should see the video appear as attached context with a metadata summary instead of a downloaded media file.

For a tool-path test, send a prompt like:

> Search Google Drive for our Q1 planning deck and save the best match into `inputs/`.

Or for YouTube:

> Review the attached YouTube video context and summarize the speaker's main claims.

Or for Outlook:

> Search Outlook for emails about the Q2 launch from the last week, then check my calendar for launch-related meetings tomorrow.

Or for pCloud:

> Search pCloud for the latest planning PDF and save it into `inputs/`.

Or for rclone:

> Search rclone for the latest planning PDF and save it into `inputs/`.

---

## Common issues

### "Redirect URI mismatch" or provider rejects the callback

Check that:

- `server.publicUrl` matches your real public API URL,
- the provider app uses the exact callback path,
- the saved redirect URI has no extra slash or wrong subdomain.

### Provider saves in Admin, but workspaces still cannot connect

Check that:

- the provider is actually **enabled** in **Admin → Sources**,
- the client secret was saved,
- the workspace owner is using **Connectors → Sources** (not just the task composer).

### Outlook appears in Admin, but users cannot write calendar events

Check that:

- the Microsoft app registration includes `Calendars.ReadWrite`, `Mail.Read`, `offline_access`, and `User.Read`,
- the workspace account was connected or reconnected after those permissions were added,
- the tenant's consent policy allows delegated calendar write access for that app.

### YouTube does not appear in the task composer

Check that:

- **YouTube** is enabled in **Admin → Sources**,
- the deployment has been rebuilt so the bundled source manifest is present,
- the web app has been redeployed so the latest source UI is loaded.

### Workspace is connected, but task-time source tools fail inside runs

Check that:

- the worker/sandbox can reach the Meowbert API,
- `server.internalUrl` is set when the public API URL is not reachable from the task runtime,
- your worker runtime still has outbound network access for source-enabled runs.

### rclone config does not save

Check that:

- **rclone** is enabled in **Admin → Sources**,
- the pasted config contains a section with the exact remote name,
- the optional base directory stays inside the remote and actually exists,
- the API server can run `rclone`.

### Google Drive, OneDrive, pCloud, or rclone live sync does not appear

Check that:

- for Google Drive, the Google OAuth app uses `https://www.googleapis.com/auth/drive`,
- for OneDrive, the Microsoft app registration includes `Files.ReadWrite`, `offline_access`, and `User.Read`,
- for pCloud, the workspace source connection is active,
- for rclone, the workspace rclone config has been saved successfully,
- the workspace account was reconnected from **Connectors → Sources** after write access was added,
- the current workspace connection can actually grant delegated write access in that provider account or tenant.

### Direct Google Workspace attachment is unavailable or fails to start

Check that:

- the Google Drive connection has write access and was reconnected after that access was added,
- the file was attached with **Attach Google files directly** rather than converted to an Office file,
- the reference file has not been edited manually,
- the published sandbox runtime image includes the bundled `google-workspace` skill and its pinned Python dependencies.

Changes under `skills/` or `apps/sandbox-runtime/` require rebuilding and publishing the sandbox runtime image before hosted tasks can use the updated skill.

### OneDrive or Outlook users cannot approve the app

Check that:

- the app registration includes the delegated Microsoft Graph permissions the source needs,
- the tenant's consent policy allows the app,
- the supported account type matches the kind of account being used.

---

## References

Official provider docs change over time, so always defer to these pages if a dashboard flow looks different:

- Google Drive API / setup overview: [developers.google.com/drive/api/guides/enable-sdk](https://developers.google.com/drive/api/guides/enable-sdk)
- Google Docs API overview: [developers.google.com/workspace/docs/api/how-tos/overview](https://developers.google.com/workspace/docs/api/how-tos/overview)
- Google Sheets API overview: [developers.google.com/workspace/sheets/api/guides/concepts](https://developers.google.com/workspace/sheets/api/guides/concepts)
- Google Slides API overview: [developers.google.com/workspace/slides/api/guides/overview](https://developers.google.com/workspace/slides/api/guides/overview)
- Google OAuth for web server apps: [developers.google.com/identity/protocols/oauth2/web-server](https://developers.google.com/identity/protocols/oauth2/web-server)
- Microsoft identity platform app registration quickstart: [learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- Microsoft identity platform supported account types: [learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- Microsoft Graph delegated auth overview: [learn.microsoft.com/en-us/graph/auth-v2-user](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- Microsoft Graph permissions overview: [learn.microsoft.com/en-us/graph/permissions-overview](https://learn.microsoft.com/en-us/graph/permissions-overview)
- pCloud OAuth authorize: [docs.pcloud.com/methods/oauth_2.0/authorize.html](https://docs.pcloud.com/methods/oauth_2.0/authorize.html)
- pCloud file and folder API: [docs.pcloud.com/methods/](https://docs.pcloud.com/methods/)
- rclone command reference: [rclone.org/commands/](https://rclone.org/commands/)
