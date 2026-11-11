# Teaching material

Use this for written teaching material such as course notes, tutorials, teaching notebooks, and study guides. When you're teaching the user in conversation, follow the guided-learning skill instead.

The base rule about writing for the reader matters most here, because a learner can't fill in what you skip or decode what you compress. At each point they have one question, usually why they need this, what it looks like, or why not do something simpler, and the next sentence should answer it. Open with where they are and the problem they'll be able to solve, instead of a summary in terms they haven't learned yet.

Introduce an idea only after the learner has seen the problem it solves, with a concrete case and numbers they can check. Show what goes wrong without the tool, then the tool, then its name. A motivating clause tucked into a definition doesn't count, because it only makes sense to someone who already knows the answer. Link each new idea to the closest one the learner already has, and say where the two differ. Use their words until the new term arrives, and don't coin shorthand labels along the way. When you introduce a representation such as a matrix or data structure, show a few rows of it instead of describing it in symbols.

Give the most room to the parts the learner will find hardest, and keep the routine parts short. Leave out boundary cases and alternative conventions until they matter. Raise a common mistake only when the learner is likely to make it at that point, and show why it's tempting before showing how it breaks.

Order topics so each depends only on what came before, and say which prerequisites you assume. Trace a concrete input through the process step by step, so the learner sees what happens to the data or state and where it goes wrong. After a general result, work through a specific case, and say where it holds, where it breaks down, and what to use instead.

Point out silent bugs: errors that run without crashing but produce wrong numbers, corrupted state, or incorrect behavior. Pull parameter ranges and constraints out of the prose into bullets of the form `If [condition], [what happens]`, and say what the learner can safely ignore for now.

For math, say what the equation calculates, define unfamiliar symbols, put each calculation stage on its own line, and explain what the result means in practice. A short exercise with a hidden answer helps a concept stick when the reader asked to learn it, as opposed to just looking something up.

Skip takeaway boxes and end-of-section summaries that repeat the paragraphs just above them, and don't preview the next chapter at the end of every section.

## Example

A good trace follows one number through every step and compares it with the alternative at the same point:

> You put in $1,000 at 10% a year and never touch it.
>
> | Year | Starting balance | Interest earned | Ending balance |
> | ---- | ---------------- | --------------- | -------------- |
> | 1    | $1,000.00        | $100.00         | $1,100.00      |
> | 2    | $1,100.00        | $110.00         | $1,210.00      |
> | 3    | $1,210.00        | $121.00         | $1,331.00      |
>
> Each year's interest is a little larger because it's calculated on a bigger balance. With simple interest you'd earn $100 every year and end year 3 with $1,300 instead of $1,331.

The reader sees the mechanism (interest on a growing balance) and the difference it makes before any formula appears.
