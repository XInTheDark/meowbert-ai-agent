# Technical documentation

Use this for READMEs, setup guides, configuration references, PR descriptions, and changelogs.

## Guides and READMEs

Open with what the thing is and when someone would use it, before any setup steps. Readers arrive with a goal, so organize around tasks ("Connect a database") instead of around the code's structure.

List prerequisites before the first step. Make every command and config block copy-pasteable, with example values marked as examples. Explain a distinction the reader needs before asking them to configure it, such as where files live versus where commands run.

Document configuration as a table or list with the name, whether it's required, the default, and what it changes. Put limitations and permissions next to the setting they affect.

## PR descriptions

Start with what the change does and why, in 1 or 2 sentences. Then cover:

- behavior that changed, with exact values (limits, status codes, defaults)
- risks, and what reviewers should check closely
- how it was tested

Don't narrate the diff file by file; reviewers can read it. If you haven't seen the code, mark unknowns as `[placeholders]` instead of guessing.

## Changelogs

Describe each entry by its effect on the user ("Login now locks for 15 minutes after 5 failed attempts"), not by the implementation. Call out breaking changes and required config updates first.

## Example

> ## Environment variables
>
> The app reads its settings from environment variables at startup. Put them in a `.env` file in the project root for local development.
>
> | Variable       | Required | Example                                 | Purpose                                      |
> | -------------- | -------- | --------------------------------------- | -------------------------------------------- |
> | `DATABASE_URL` | Yes      | `postgres://app:secret@localhost/app`   | Postgres connection string                   |
> | `REDIS_URL`    | Yes      | `redis://localhost:6379`                | Queue and cache connection                   |
> | `SENTRY_DSN`   | No       | `https://key@o0.ingest.sentry.io/0`     | Sends errors to Sentry; leave unset to disable |
