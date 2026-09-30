---
title: Notifications
summary: Control browser or desktop alerts and review delivery status across workspace tasks.
onboardingId: notifications
checklistLabel: Notifications
---

# Notifications

The Notifications page lets you monitor task events and configure notifications so you're informed even when you're not actively watching the Task Detail view.

## Why use notifications?

Meowbert tasks can take several minutes (or longer for scheduled/infinite tasks). Rather than keeping a tab or window open and watching, you can enable notifications and get alerted when:

- A task completes successfully.
- A task fails or errors out.
- A task is waiting for your input (`awaiting_input`).
- A connector-triggered task produces a response.

## Enabling notifications

1. Go to **Notifications** in the sidebar.
2. Turn on notifications.
3. Click **Allow notifications** if permission has not been granted yet.
4. Approve the browser or desktop permission prompt.

In the browser, you may need to reset notification permission in your site settings if you previously clicked **Block**.

On Meowbert Desktop, the app uses native desktop notifications instead of browser tab notifications.

## Reading the notifications list

The Notifications page shows a log of recent task events delivered to your account. Each entry shows:

- **Task** — a link to the task that triggered the notification.
- **Status** — `sent`, `failed`, or `suppressed`.
- **Message** — a short description of what happened.
- **Timestamp** — when the event occurred.

**Suppressed** means the notification was generated but not delivered — typically because notifications were disabled at the time, or the tab/window was already focused on that task.

## Notification scope

Notifications are scoped to the **workspace** you're currently viewing. If you have multiple workspaces, switch to the correct one to see that workspace's notifications.

## Clearing notifications

Use the **Clear read** or **Clear all** controls to clean up the notification log. This does not affect the underlying tasks.

## Desktop tip

If you use Meowbert Desktop, see [Desktop App](/getting-started/desktop-app) for shortcuts, native notifications, and file-dialog behavior.
