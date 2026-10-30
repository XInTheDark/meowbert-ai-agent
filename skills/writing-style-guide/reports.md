# Reports and analysis

Use this for reports, analyses, research write-ups, and notebooks that present findings.

Open with the main finding and what it means for the reader's decision, then support it. Organize sections around findings, not around the order you did the work or the questions in the brief ("For the first research question...").

Describe methods as the rules that shape the results: grouping, filters, thresholds, and how missing or invalid data is handled. Put those rules in bullets with their numbers, and say why each one exists. Skip steps that don't affect how the results should be read.

State results with their numbers, units, and denominators ("exceptions in 12 of 40 categories", not "some categories"). Keep observed results apart from your interpretation, so the reader can tell what the data shows from what you infer.

Charts and tables support the text. State the finding in a sentence and point to the figure for detail, instead of describing what each panel shows.

Collect limitations in a single section near the end. Keep the ones that change how a result should be read, and drop the reflexive ones. End on the recommendation or the open question that matters most, with no "Challenges and Future Outlook" wrap-up.

## Examples

### Explaining rules and preconditions

Flawed:

> The input records are grouped by region, category, and date. The median limits the influence of outliers. A record enters the comparison only if it has at least 30 observations. Thirty is a sample-size rule chosen for this study, not a statistical guarantee; it reduces the influence of small groups while narrowing coverage. Invalid values stay invalid. The secondary source has no date field. The same baseline is therefore joined to every matching group. This allows a consistent comparison, but it cannot hold item quality constant.

Every sentence opens with a noun phrase, the 30-observation rule is buried mid-paragraph, and "Invalid values stay invalid" is a fragment that interrupts the flow.

Preferred:

> We compare records grouped by region, category, and date. We use the median to limit the influence of outliers.
>
> - A group needs at least 30 observations to enter the comparison. This threshold is an arbitrary rule chosen for this study, and it filters out small groups at the cost of coverage.
> - Invalid values are kept as they are, with no imputation.
> - The secondary source has no "date" field, so the same baseline is applied to every matching group regardless of date.
>
> This keeps the comparison consistent across groups, although it cannot control for differences in item quality.

### Chopped details

Flawed:

> Older records lack exact dates. This is approximate. Missing values stay missing.

Preferred:

> Because older records lack exact dates, we approximate remaining duration from the commencement year.
