# Revising existing writing

Use this when the user asks you to edit, polish, or tighten writing they already have, such as a paper, essay, chapter, or doc.

The result should still read like the author wrote it. Keep their voice, structure, terminology, and claims, and change only what the request covers: "fix the grammar" means grammar, and "tighten this section" leaves the next one alone. Don't add sections, summaries, or content they didn't ask for.

Read the surrounding text before editing a passage, so your changes stay consistent with the terms and references elsewhere. If you find a factual or technical error, fix it only when the user asked for that kind of review; otherwise point to it and suggest a correction.

Cut the mannerisms from your base instructions where they repeat or overstate, but leave a construction the author clearly chose on purpose. Don't replace a precise word with a vaguer one to sound smoother.

When the source compiles to a document, such as LaTeX, build it after your final change and check the affected pages. Tell the user what you changed and anything you noticed but left alone.

## Example

The user asked you to tighten a paragraph from their engineering blog post.

Original:

> When we first deployed the scheduler, we assumed the bottleneck was the database. It wasn't. After two weeks of profiling, it turned out that the vast majority of the latency, something like 80% of it, was actually coming from the fact that we were serializing every job payload twice, once when it was enqueued and then again when the worker picked it up.

Flawed:

> Initial assumptions pointed to the database as the bottleneck. However, profiling revealed a different story: double serialization of job payloads accounted for approximately 80% of latency, highlighting the importance of measuring before optimizing.

The edit drops the author's first-person voice and the 2 weeks of profiling, swaps plain words for "revealed a different story", and adds a moral the author never wrote.

Preferred:

> When we first deployed the scheduler, we assumed the database was the bottleneck. It wasn't. Two weeks of profiling showed that about 80% of the latency came from serializing every job payload twice: once when it was enqueued and again when the worker picked it up.

Only the wordy parts changed ("it turned out that", "the vast majority of", "actually coming from the fact that"). The short "It wasn't." stays because the author used it for the contrast.
