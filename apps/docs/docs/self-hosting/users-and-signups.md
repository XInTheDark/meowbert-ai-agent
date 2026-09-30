---
title: Users & Sign-ups
summary: Control who can create an account on your server, and manage the people who have one.
---

# Users & Sign-ups

The first account created on a new server becomes its **admin**. After that, sign-ups are closed until you open them.

## Sign-up options

Choose one in the setup wizard, or later in **Admin Panel → Settings**:

| Option | Settings | Good for |
| --- | --- | --- |
| **Only me** | Allow sign-ups: off | Personal servers |
| **With approval** | Allow sign-ups: on, Require admin approval: on | Teams and families on a server others can reach |
| **Open** | Allow sign-ups: on, Require admin approval: off | Private networks where everyone is trusted |

With approval on, new accounts wait in **Admin Panel → Users** until you approve them.

**Email verification** and **Forgot password** need [outgoing email](/reference/email-delivery), so they're off until you set it up.

## Managing users

**Admin Panel → Users** lets you approve or deactivate accounts, reset passwords, make someone an admin, and adjust per-user limits.

## Usage limits

By default, everyone can send as many messages as they like. To cap usage, set **Messages per user** in **Admin Panel → Settings**, override it for individual users in **Admin Panel → Users**, or create subscription plans with token limits in **Admin Panel → Plans**. Admins are never limited, and users who connect [their own provider](/core-workflows/byo-providers) aren't counted against these limits.

## Workspaces

Every user gets their own workspace. To work together, invite people to a shared workspace from its settings. Members share its projects, connectors, and memory.
