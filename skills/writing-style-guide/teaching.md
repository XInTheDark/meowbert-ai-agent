# Teaching material

Use this for written teaching material such as course notes, tutorials, and study guides. When you're teaching the user in conversation, follow the guided-learning skill instead.

Start from an idea the reader already understands, show what changes, and explain why the change matters. Trace a concrete input or scenario through the process step by step, so the reader sees what happens to the data or state and where it goes wrong.

Point out silent bugs: errors that run without crashing but produce wrong numbers, corrupted state, or incorrect behavior. When a common mistake looks reasonable, show why it's appealing before showing how it breaks. This is for mistakes readers actually make, not alternatives invented to be knocked down.

Pull parameter ranges and constraints out of the prose into bullets of the form `If [condition], [what happens]`. Say what the reader can safely ignore for now so they aren't buried in premature detail, and finish with a rule of thumb they will remember.

For math, say what the equation calculates, define unfamiliar symbols, put each calculation stage on its own line, and explain what the result means in practice. A short exercise with a hidden answer helps a concept stick when the reader asked to learn it, as opposed to just looking something up.

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
