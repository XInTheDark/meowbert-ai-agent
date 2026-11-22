// What the model reads when it loads the harness-settings tool group.
export const HARNESS_SETTINGS_GUIDE = [
  "These settings change how the harness runs this task between your runs. Change them with `harness_settings`; every key is required and null leaves a setting as it is.",
  "",
  "**Keep-alive** keeps the task running until a deadline. While it is on, `final_response` delivers your answer and ends the current cycle, and the harness starts the next cycle after the wake interval. Each new cycle opens with a note saying how much time is left. Use the time to verify, improve or continue the work. If a cycle has nothing useful to do, end it quickly with a short `final_response`; the harness waits longer after idle cycles. `wait` still works for a specific delay. You can end keep-alive only if you started it.",
  "",
  "**Wake interval** sets how long the harness waits between keep-alive cycles, for work that should be checked on a cadence.",
  "",
  "**Stop check** is a shell command that must exit 0 before the task can finish. When it fails, your `final_response` is rejected with the command's output and you keep working. After a few failed attempts in a row the answer goes through with a note that the check is still failing.",
  "",
  "**Token budget** caps the tokens this task may use. You can set one or lower it, never raise it. When it runs out you are asked to wrap up.",
  "",
  "**Notify** chooses when the user hears about this task: on_finish (every answer, the default), on_failure (only failed runs and keep-alive stopping), or never.",
  "",
  "**Warm sandbox** keeps your sandbox running for a while after each run, so background processes and installed packages are still there next time. Files in the task and project folders persist either way.",
  "",
  "Settings the user made are limits you work within: you can't change or clear them, except to extend keep-alive or lower a budget. Each result shows every setting, who set it, and how far you may extend keep-alive."
].join("\n");
