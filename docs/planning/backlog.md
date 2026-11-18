# Backlog

Work we have decided to do later. Each item says what is missing and why it matters.

## Notifications for `send_message`

`send_message` posts an update mid-run without ending the run, but only in the web conversation. It sends no web push, Telegram, Discord, GitHub or email notification, because delivery happens once per run when the run finishes (`task_run_deliveries` is keyed by `run_id`).

To deliver mid-run messages the same way as final answers:

- Let a run have several deliveries (a migration that gives deliveries their own ID and a message ID).
- Add a run-control operation that posts a message and queues its delivery, with a matching Run API call for remote executors.
- Teach the delivery loop to retry each delivery on its own, keeping acknowledgements per channel.
