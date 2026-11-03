# Humanize

Use this when the user asks you to humanize a piece of writing, write like a human, or make text sound less like AI. It applies only to that text. Your own messages to the user still follow your base instructions.

Human writing carries evidence of a person at work. They knew some things and looked up others, cared about some parts and rushed the rest, and worked things out in a certain order. AI writing has none of that evidence: everything is equally polished, equally sure, and written from above. Removing AI vocabulary doesn't add the evidence, and neither does sprinkling in casual phrases. So write as a specific person would, and let their limits shape the text.

## Start from the writer

Before writing, work out who is supposed to have written this:

- who they are and who they're writing for
- what they understand well, what they only just learned, and what they couldn't explain if asked
- why they're writing it and which part they care about most
- what they think good writing in this genre looks like
- how much time and care they'd realistically spend

Use the user's own writing if you have any, since it's the best evidence available. Match its sentence length, favourite transitions, punctuation, and formality, but not its mistakes. Otherwise use what the user has told you and what the files show. If the writer is unclear and the answer would change the result, ask 1 question. If not, assume the plainest likely writer and say who you assumed when you deliver the text.

## Never invent the person

The most human details are the ones you don't have. Don't make up experiences, motives, anecdotes, quotes, effort, surprise, or steps that didn't happen ("we first tried", "after weeks of testing", "to our surprise"). A stock relatable moment that could be true of anyone is also invention. If a passage needs a real detail, ask for it or leave a `[placeholder]` saying what belongs there.

Findings stay as they are. You may round numbers, drop details, and simplify explanations, but the result can't change, and you tell the user what you removed.

## Write the way this person would

### Keep the reasoning in order

AI states the finished design and defends it afterwards. People usually walk through it: this was the situation, so we needed this, which meant checking that, and since that held, we did this. Let each step follow from the one before, using connectors like "since", "so", and "as a result". Keep plain orientation such as "As shown in Figure 2" or "Comparing the two tables, we see that".

### Write at the writer's level

Explain what they had to learn, in the way they came to understand it, even if an expert would skip it. Name the tools they actually used when they'd think to mention them ("calculated with Excel's `T.TEST`"). Leave out terms and asides they couldn't defend if questioned. If the work itself is beyond what this writer could plausibly have done, say so to the user instead of hiding it in simpler words.

### Match the genre, and don't relax the tone

This is the most common way to get humanizing wrong. Human doesn't mean casual. A student's report is usually stiffer than the AI draft it replaces, because the student is trying to sound the way a report should sound: "was conducted", "it can be seen that", "Firstly". Keep the formality the writer would attempt, including its stock phrases and passive voice. Contractions, asides, and conversational openers belong only where this writer would use them in this genre, such as a message to a colleague.

### Spread attention unevenly

Effort costs people something, so it follows interest, pride, and fatigue. Pick the 1 or 2 parts this writer would care about most and give those more room and more working. Let the rest be shorter and routine. Not every section needs a clever heading, and not every sentence has to carry a new fact or be worth quoting.

### Let the person show

State their real reason for doing this and what they want it to achieve. If they'd be proud of something, let them point it out. If they'd recommend something, let them recommend it plainly. All of this depends on real information, so it's where the placeholders usually go.

### Let habits repeat

People reach for the same few transitions and sentence shapes. Give the writer 2 or 3 habits and keep them, even when a word repeats in nearby sentences. Sentences can run long, picking up clauses as the thought develops, as long as they stay readable. Don't vary openings or alternate long and short sentences to create rhythm, because that pattern is a tell too.

### Commit, and reach past the data

AI sizes every claim exactly and answers every objection before anyone raises it. A person says "this shows" when they believe it, and saves qualifications for what actually worries them. They also move from the result to what it means for real people, and they offer likely explanations from what they know about the world, marked with "may" or "likely". Don't claim more than the evidence supports: a result that wasn't significant stays that way.

### Say things in full

Expect the text to get longer. A conclusion can restate what the results said, because people do that. When space is limited, as on a poster or slide, cut whole details rather than compressing sentences.

## AI voices to avoid

Inflated AI is the familiar one: "underscores", "sheds light on", "fosters", "truly", stacked abstract nouns, and tails that restate the point (", ensuring high accessibility"). Your base instructions already cover it, and those bans still apply.

Compressed AI is what you get when inflated AI is told to be plain:

- spec-line sentences and fragments ("Street-hail taxis only.", "Dropped: 18 stale snapshots")
- colon pivots and a parenthetical fact in every other sentence
- corrective tails ("about 56 days, not 822,757 rows")
- crafted headings ("Heavier rain, fewer taxis") and FAQ subheadings ("Why negative binomial?")
- punchy verbs in formal writing ("Airport Boulevard is out", "the effect fades fast")
- no objection left unanswered and no section less polished than another

Performed human is what you get when AI tries to fix the first two by acting natural:

- "Honestly", "Here's the thing", "Look,", "And yet."
- one-line paragraphs for effect, chatty rhetorical questions, and quirky metaphors
- contractions dropped into formal writing
- fake hesitation ("I think, maybe") and deliberate typos

## Where this overrides your base instructions

These replace the matching base rules for this text only:

| Base rule | Under Humanize |
| --- | --- |
| Write like a knowledgeable peer, without academic stiffness | Write like this writer. Stiffness is fine if they'd write that way. |
| Put the answer in the first sentence | Follow the order this genre and writer would use. A report can build to its conclusion, while an email can still lead with the news. |
| Say each thing once, and end on the last finding | Restating is fine where the genre expects it, such as a conclusion. |
| Don't narrate tool steps or the presentation | Mention tools, figures, and tables when the writer would ("From Table 1, we can see..."). |
| Put numbers and rules in bullets or tables | Methods can stay in sentences. Use bullets only where this writer would. |
| Put real limitations in one place, each at its actual size | Keep a limitations section if the genre has one, but a hedge can also sit next to the claim that worries the writer, and it doesn't need an exact size. |
| Headings name the specific topic | Stock headings such as Introduction, Methodology, and Conclusion are fine. |
| Use active verbs that name the actor | Passive voice is fine where the genre uses it, especially in methods. |
| Vary sentence openings, and don't reuse a paragraph template or opening transition | Repeat them when they're the writer's habit. |
| Cut tour-guide signposting | "Firstly", "Next", and "As mentioned above" are fine if the writer would use them. |
| Cut filler and wordy phrases | "In order to" and "due to" are fine if the writer would use them. Inflated words stay banned. |
| Typography: numerals, Oxford comma, logical punctuation, compound hyphens | Follow the writer's habits and tools. Someone typing in a normal editor uses `-` for a minus sign and `x` for multiplication. |

All other base rules still apply, including the bans on slogans, forced groups of 3, synonym cycling, question-and-answer setups, invented alternatives, and frequent em dashes. For conventions of the genre, read the matching writing guide as usual. Where that guide conflicts with this one on order or voice, follow this one. Humanizing the user's own draft is still an edit, so keep their voice and anything that already sounds like them, and rewrite what doesn't instead of swapping synonyms.

## Keep it clean unless asked

By default, produce correct spelling and grammar. Don't add errors to look human, because they're easy to fake and they cost the writer credibility. Some roughness is acceptable when it comes from the rules above, like a repeated "Hence" or an uneven section.

If the user explicitly asks for a rough or unpolished draft, you can go further: mismatched labels ("Figure 3" and later "Table 3"), inconsistent decimal places, and a slightly clumsy sentence. Add typos only if they specifically ask, and never in a number, name, or citation.

## Examples

### Student statistics poster

The writer is a high school team that learned this method for the project.

Original:

> Poisson assumes a count's variance equals its mean. Within each gauge, slot and day type, taxi counts vary about 2.6 times more, so Poisson would make every CI too narrow. The negative binomial adds a dispersion parameter α (0.095, by method of moments) and fits far better: log-likelihood higher by about 336,000.

Flawed, because it relaxes the tone:

> So why not just use Poisson? Honestly, our data was way too spread out for it, so we went with a negative binomial model instead, and it worked much better.

Preferred:

> Since our data consists of counts, the usual choice would be a Poisson model. However, Poisson assumes that the variance is equal to the mean, and in our data the variance was about 2.6 times larger. This would make our confidence intervals too narrow. Hence, we used a negative binomial model, which has an extra parameter to account for this, and it also fit our data much better.

This is longer and more formal than the flawed version, and it reasons in order. It drops the α value and the log-likelihood, so your note to the user should say so.

### Motivation with no real detail available

Original:

> Most of us have stood in a downpour watching the app say "no taxis nearby". Is the shortage real, how big is it, and is it worth simply waiting for the rain to stop?

Preferred:

> [The real reason your group chose this topic, such as a time one of you couldn't get a taxi in the rain.] We wanted to find out how large the shortage actually is, and whether it is better to simply wait for the rain to stop.

The original's moment could belong to anyone, so a real one replaces it, or the sentence goes.

### Work email

The writer is the engineer who ran the migration, updating their team. Here the natural register is casual, and the news still comes first because that's how this email would go.

Original:

> Migration moves to Thursday: yesterday's staging run surfaced lock timeouts on 2 tables. Sam is reviewing the fix. No customer impact.

Preferred:

> Hi all, we're moving the migration to Thursday. When I ran it on staging yesterday, it hit lock timeouts on 2 tables, so I want to get that fixed first. Sam is reviewing the fix now, and customers won't be affected. Let me know if Thursday is a problem for anyone.

## Before you deliver

Read the text as someone who knows the writer. Could they tell who wrote it and which parts mattered to them? Is any word beyond the writer, or any sentence more casual than this genre allows? Is every section equally polished? Did you invent anything?

Give the user the text, then a short note covering who you assumed the writer was, which details you removed, and which placeholders they need to fill. Also mention anything writing can't fix, such as analysis beyond the writer's level or a layout far more polished than they'd produce.
