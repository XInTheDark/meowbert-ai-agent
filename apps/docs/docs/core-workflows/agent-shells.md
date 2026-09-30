---
title: Agent shell sessions
summary: Agents can keep shells and servers running in the background. See their output and stop them here.
onboardingId: agent-shells
checklistLabel: Shell sessions
---

# Agent shell sessions

Open the shell monitor from a project’s active-shell control, or open **Shells** in a task. You can read output and stop sessions that are no longer needed.

An agent's ordinary shell commands each start in a fresh shell. Files remain available, but changing directories or setting shell variables does not affect the next command.

The sandbox includes a Jupyter Python kernel and Matplotlib. Agents can use them to keep Python variables between calculations and save charts in your project.

For work that needs a lasting shell, the agent can create a **shell session**. Commands in that session share their working directory, variables, and environment. The session stays available across task runs and worker restarts. When a command finishes, the shell becomes idle and can accept another command.

The agent can answer prompts, send input to a REPL, interrupt a running command, or send EOF. Terminal mode supports interactive programs; pipe mode provides exact input and closes stdin when EOF is requested. You can inspect output and terminate these sessions from the shell monitor. Manual input through the monitor is not supported.

The agent first starts a session, optionally with a command, and receives its session ID. It uses that ID to read output and send answers, including a newline to press Enter. Once the command finishes, it can run another command in the same session. If startup fails without returning an ID, there is no usable session to send input to; the runtime failure needs to be resolved first.

During a normal task, the agent can wait for a fixed time, new output from a shell session, or a command to finish. It can watch several sessions at once and continues as soon as any selected condition is met. Every wait has a time limit of up to one hour, and cancelling the task interrupts the wait. Finishing a command includes both success and failure; the shell itself can stay open for more work.

Idle sessions continue using persistent runtime credits until stopped. Output keeps the most recent 5 MiB, so new prompts remain visible during long sessions. Stop sessions when they are no longer needed. If a session's container is lost, start a new session; commands are not replayed automatically.
