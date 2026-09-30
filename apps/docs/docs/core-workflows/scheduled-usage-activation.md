---
title: Scheduled usage activation
summary: Use Admin → Utilities to send small, scheduled requests to an AI provider and model.
---

# Scheduled usage activation

Super admins can open **Admin → Utilities** and create schedules that send a small request to a selected platform provider and model. This can help use a provider's rolling usage window at predictable times.

Schedules are disabled until you enable them. Every time is entered in **UTC**. Each schedule can contain several rules:

- **At a time** on selected weekdays, such as Monday–Friday at 03:00.
- **Every interval** within one or more daily windows, such as every 30 minutes from 03:00–05:00 and 18:00–20:00.

Create separate schedules when different models or days need different settings. A missed occurrence is skipped after a short grace period, and a failed provider request is recorded without automatic retries. The Utilities list shows the next occurrence and the last result so you can pause or adjust a schedule safely.

The request uses the selected AI provider's credentials and counts against that provider's usage. Keep the model prompt and output small by design; this utility is intended to activate usage windows, not to run a task.
