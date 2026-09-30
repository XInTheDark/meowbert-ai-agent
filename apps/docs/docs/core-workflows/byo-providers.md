---
title: Bring Your Own Provider & Subscriptions
summary: Connect your personal ChatGPT Plus/Pro subscription or custom OpenAI-compatible API key.
---

# Bring Your Own Provider & Subscriptions

Meowbert lets you power agent tasks using your own AI subscriptions or custom API keys via **Bring Your Own (BYO)** mode.

You can configure BYO settings anytime by navigating to **User Settings → Subscription & Providers**.

When BYO is disabled, tasks use the provider selected by your server admin. Admins manage these connections in **Admin → AI providers**: add a base URL and API key, select a provider to use it, or remove a saved connection. The first provider is selected automatically. Switching providers applies to new runs; runs already in progress keep their current connection. Removing the selected provider requires selecting another before new platform AI runs can start. Model choices remain under **Admin → Model**.

---

## Supported BYO options

### 1. Sign in with ChatGPT (experimental)

If you already have a personal or team **ChatGPT Plus, Pro, or Team** subscription, you can connect your OpenAI account directly to Meowbert without creating or paying for separate API keys.

#### How it works

1. Go to **Subscription & Providers** and select the **Sign in with ChatGPT** tab.
2. Click **Sign in with ChatGPT** to open the activation modal.
3. Meowbert will generate a unique one-time device code. Click **Open OpenAI Activation** or visit the activation page.
4. Sign in to your ChatGPT account and confirm the code.
5. Once authorized, Meowbert automatically activates ChatGPT BYO mode. You can optionally force a model for every ChatGPT BYO task.

::: warning Experimental
Sign in with ChatGPT isn't an official OpenAI integration. Meowbert uses the same sign-in flow as other open-source coding tools (the implementation follows [opencode](https://opencode.ai)'s), which reuses the Codex CLI's [device-code login](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs). OpenAI can change or block it at any time, so it may stop working without notice. Check that this use is allowed under your OpenAI account's terms.

For a more reliable setup, run a subscription proxy such as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and connect it as a [Custom API Key](#_2-custom-api-key-openai-compatible) instead.
:::

#### Managing your connection

- **Force default model**: Enter an exact model identifier if every ChatGPT BYO task should use the same model. Leave it blank to use the model selected for each task.
- **Disconnect anytime**: Click the **Disconnect** button to unlink your ChatGPT account and restore standard workspace billing.

---

### 2. Custom API Key (OpenAI-compatible)

If you prefer using an API key from OpenAI, OpenRouter, DeepSeek, or a self-hosted inference server (such as vLLM or Ollama), you can configure a custom endpoint:

1. Select the **Custom API Key** tab.
2. Enter your **Base URL** (e.g. `https://api.openai.com/v1` or `https://openrouter.ai/api/v1`).
3. Enter your **Model** identifier (e.g. `gpt-4o`, `deepseek-chat`).
4. Paste your **API key**.
5. Click **Fetch Models** to verify the connection and discover available models, then click **Use Custom API Key**.

---

## Switching or disabling BYO

- You can switch between **ChatGPT Account** and **Custom API Key** at any time.
- To pause using your own provider and go back to the server's provider and any usage limits your admin has set, click **Disable BYO** in the top right of the section.
