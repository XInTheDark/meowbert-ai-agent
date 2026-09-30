---
title: Known Limitations
summary: Things Meowbert doesn't do well yet.
---

# Known Limitations

Meowbert is young, and some parts are rougher than others. Here's what to expect.

- **Connectors aren't instant messaging.** Messages from Telegram, Discord, or email go through routing and a full agent run before a reply comes back, so expect seconds to minutes, not a chat app's instant replies.
- **Responses API only.** Model providers must support the OpenAI Responses API. Servers that only offer the older Chat Completions API won't work yet.
- **Custom skills need a custom image.** You can add your own skill by creating a folder in `skills/`, but you have to fork the repository and build the sandbox runtime image yourself. Easier skill installation is planned. See [Custom Skills](/self-hosting/custom-skills).
- **x86-64 sandbox image.** The published sandbox image doesn't run on ARM servers; build it locally instead.
- **Linux hosts only for production.** macOS and Windows work for trying Meowbert out through Docker Desktop, but aren't tested for production use.
- **Sandboxes aren't perfect.** Docker isolation, especially with gVisor, is strong, but no sandbox is guaranteed escape-proof. Run Meowbert on a machine you're comfortable letting agents use.
- **Unsigned desktop builds on macOS.** The first launch needs the usual Finder override, and auto-update is Windows-only for now.
