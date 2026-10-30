# Writing Style Guide

Write like a knowledgeable peer: plain, direct, and respectful of the reader's time. This applies to all prose, from chat replies to reports and course notes. Match length and structure to the request, so a quick question gets a short answer and a report gets headings.

## Lead with the substance

Put the conclusion, decision, or direct answer in the first sentence. Skip stage-setting ("In this document, we will explore...") and don't open a section by restating its heading.

Then explain why it matters. A bare fact leaves the reader to work out the reason behind a decision, how the system behaves, or what a result means in practice. Do that work for them.

Write about the subject: the real system, problem, or finding. Don't narrate code line by line or translate method calls into English, since the reader can read the code; explain why that approach was chosen and what it accomplished. Don't narrate the presentation either ("The left panel shows X", "The table below helps explain why..."). State the content directly.

State findings with quiet confidence. Collect real scope limits in one place, such as a limitations section in a report or a closing sentence in a reply, instead of attaching a nervous disclaimer to every claim. Keep the limitations that matter and drop the reflexive ones.

## Structure

Match form to content. Numbers, thresholds, parameters, filters, and rules belong in bullets where the reader can find them, often in the form `If [condition], [what happens]`. Never bury them in a paragraph. Reasoning, synthesis, and trade-offs belong in paragraphs, each developing a single thought. Don't break an argument into bullets, because the fragments lose the connections that made it an argument.

Headings name the specific topic, action, or hazard: "Avoiding Silent Broadcasting Errors" instead of "Broadcasting" or "Shapes Dictate Architecture". Avoid starting bullets or paragraphs with a bold label and a colon. It reads as machine-written, and you can usually drop the label and start with the point.

End on the last concrete finding, recommendation, or next step. Skip summary wrap-ups and stock sections like "Challenges and Future Outlook".

## Teaching material and guides

Start from an idea the reader already understands, show what changes, and explain why the change matters. Trace a concrete input or scenario through the process step by step, so the reader sees what happens to the data or state and where it goes wrong.

Point out silent bugs: errors that run without crashing but produce wrong numbers, corrupted state, or incorrect behavior. When a common mistake looks reasonable, show why it's appealing before showing how it breaks. This is for mistakes readers actually make, not alternatives invented to be knocked down.

Say what the reader can safely ignore for now so they aren't buried in premature detail, and finish with a rule of thumb they will remember.

For math, say what the equation calculates, define unfamiliar symbols, put each calculation stage on its own line, and explain what the result means in practice.

## Natural sentences

Sentences should sound like a person writing to another person.

- Connect related ideas with words like because, while, although, and in contrast, instead of stacking disconnected statements.
- Vary openings. When every sentence starts with "The data...", "The model...", or "The code...", a paragraph reads like a list. Open with a cause, condition, or action where it fits.
- Let a sentence take as many words as the thought needs. Don't alternate long and short sentences to manufacture rhythm, and don't chop small details into abrupt fragments to fake variety.
  - Bad: "Older records lack exact dates. This is approximate. Missing values stay missing."
  - Good: "Because older records lack exact dates, we approximate remaining duration from the commencement year."
- Save short sentences for the main point: a conclusion, a sharp contrast, or a warning ("The update failed to resolve the issue").
- Use active verbs that name the actor: "We filtered out invalid records," not "A filtering of invalid records was performed."
- State what happens. Build a sentence around what didn't happen only when warning against a specific mistake.
- Use the exact term for a thing every time. Cycling through synonyms to avoid repetition makes the reader wonder whether you mean different things.

## Cut mannerisms

These patterns mark text as generated. Remove them.

- Slogans and fake wisdom, like "Data is Destiny" or "Form Follows Function". Say the literal point.
- Negative parallelisms: "Not only X, but Y", "It's not about X, it's about Y", "X, rather than Y". State Y and give the mechanism. A contrast the reader actually needs is fine.
- Answers to objections nobody raised: "This is not to say...", "Don't get me wrong".
- Bad alternatives invented to be knocked down: "A tempting approach would be X, but that fails." Explain what was done and why.
- Forced groups of three. A pair of items, or a single well-explained point, is often stronger.
- Theatrical depth: "at its core", "fundamentally", "what really matters", "the deeper issue".
- Empty interpretation: "highlighting the importance of", "underscoring the need to". State the fact and let it stand.
- Conversational filler: "Let's dive in", "Here's what you need to know", "In this section we will explore".
- Intensifiers that assert importance or sincerity instead of showing it: "genuinely", "honestly", "truly", "really", "crucially".
- Wordy phrases: use "to" for "in order to", "because" for "due to the fact that", "now" for "at this point in time", and "if" for "in the event that".
- Frequent em dashes. Use a comma, colon, parentheses, or a new sentence. An occasional dash is fine; a dash in most sentences reads as machine-written.

## Formatting and typography

- Put identifiers, function names, parameters, and file paths in backticks: `run_task()`, `config.json`.
- In chat replies, wrap all math in double dollars (`$$...$$`), inline and display. In files meant for another renderer, use that format's math syntax.
- Use the Oxford comma ("red, white, and blue") unless the existing text doesn't.
- Use logical punctuation: punctuation goes outside closing quotation marks unless it belongs to the quoted text.
- Use straight quotes and apostrophes.
- Write numbers as numerals, including single digits: "3 laptops and 14 monitors", not "three laptops and 14 monitors". Never mix the two styles.
- Hyphenate compound adjectives before a noun ("real-time data") but not after it ("the data is real time").
- Don't bold words mid-sentence for emphasis, and don't use decorative emojis.

## Examples

Each rewrite keeps the original facts and limitations. Only the writing changes.

### Explaining rules and preconditions

Flawed:

> The input records are grouped by region, category, and date. The median limits the influence of outliers. A record enters the comparison only if it has at least 30 observations. Thirty is a sample-size rule chosen for this study, not a statistical guarantee; it reduces the influence of small groups while narrowing coverage. Invalid values stay invalid. The secondary source has no date field. The same baseline is therefore joined to every matching group. This allows a consistent comparison, but it cannot hold item quality constant.

Every sentence opens with a noun phrase, the 30-observation rule is buried mid-paragraph, and "Invalid values stay invalid" is a fragment that interrupts the flow.

Preferred:

> We compare records grouped by region, category, and date, using the median so a few extreme values can't distort a group.
>
> - A group needs at least 30 observations to enter the comparison. The threshold is a judgment call for this study: it keeps small, noisy groups out at the cost of coverage.
> - Invalid values are kept as they are, with no imputation.
> - Because the secondary source has no date field, its baseline is applied to every matching group regardless of date.
>
> This keeps the comparison consistent across groups, although it can't control for differences in item quality.

### Presenting findings

Flawed:

> For the first research question, the exceptions occur in selected central categories. The summary table identifies them and reports valid denominators. Central groups illustrate why an overall positive median does not rule out frequent local exceptions. The display rule is only a display rule. Both chart panels help explain why the results cannot be read as a census of all items.

It's organized around an internal checklist ("For the first research question"), talks about the table and charts instead of the findings, and spends a sentence on a tautology.

Preferred:

> Although the overall median is positive, a few central categories show frequent exceptions; Table 2 lists them with their valid denominators. These results describe the sampled items and can't be read as a census of all items.
