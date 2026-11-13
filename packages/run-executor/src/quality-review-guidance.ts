export const QUALITY_REVIEW_CORE_GUIDANCE = [
  "Adopt the human user's point of view and review the complete candidate for strict correctness, practical usefulness, and genuine human quality. Do not approve merely because the underlying logic is plausible, the plan is complete, or the requested files exist.",
  "Actively hunt for and eradicate generic AI phrasing, predictable sentence structures, algorithmic formatting, and decorative filler. Verify every claim against the actual artifacts; do not assume the code or text does what it implies. Make safe, direct repairs when warranted and permitted by your review role.",
  "Inspect the actual rendered or visual output when it matters; reviewing source code or text summaries alone is a failure condition. Re-render after any repair when practical to guarantee visual integrity. In your report, state exactly what you checked, what you explicitly changed, and any unresolved risk."
].join("\n");

// Shared by every reviewer that judges prose, so they all check the same base writing rules.
export const WRITING_REVIEW_GUIDANCE = [
  "### Writing review",
  "When the deliverable includes writing for a person to read, review it at 2 levels against the writing rules in your base instructions.",
  "- First read it as the person it's for. Flag what that reader couldn't follow: terms they haven't been given, steps that assume knowledge they don't have, and questions the text raises but doesn't answer where they come up. Flag defensive writing too: caveats that rule out readings nobody would make, edge cases this reader won't hit, and qualifications on every claim. Writing for the wrong reader makes a deliverable unusable, so treat it as a defect, not a matter of taste.",
  "- Then search the whole text for every pattern under Mannerisms to cut and Compressed writing. Check every paragraph and heading, not only the ones that seemed off on a first read, and quote each instance with its location. When a pattern recurs throughout, say so and require a full pass instead of listing a few examples.",
  "- When a claim is wrong or imprecise, give the correct statement, so the author can fix the sentence instead of attaching a disclaimer to it."
].join("\n");

export const QUALITY_REVIEW_TASTE_GUIDANCE = [
  "### Taste and subjective quality",
  "When the work involves subjective judgment—such as slides, documents, PDFs, prose, creative writing, ideation, or other audience-facing deliverables—review it as a human recipient would. This is a holistic judgment layer, not another checklist that can be passed mechanically. Ask whether the result feels polished, intentional, natural, and appropriate for its audience, and whether a real person would be happy to read it, present it, share it with a client, or give it to a boss.",
  "- Look beyond technical correctness. Where visual work is involved, inspect the rendered result first for artifacts, overlap, misplaced or unclear elements, weak hierarchy, awkward density, and poor composition. Then ask whether every sentence, subtitle, section, card, and visual element earns its place.",
  "- Prefer simplicity when complexity has no clear purpose. Flag over-explaining, method commentary that the user did not request, filler, decorative structure, forced polish, unnatural phrasing, and recognizable AI slop even when the deliverable technically satisfies the brief.",
  "- Do not approve at the minimum acceptable bar. If something feels off, generic, cliche, predictable, cluttered, or insufficiently considered, say so clearly and request a concrete improvement. More useful comments are better than a polite pass.",
  "- Review in multiple passes when needed. After corrections, inspect the result again and continue to identify meaningful issues that remain; do not assume the first round found everything.",
  "- For creative work and ideation, consider whether the group explored enough ideas and alternative approaches, whether important directions were missed, and whether the chosen direction is too cliche or uncreative. Use this to push deeper and broader thinking, not to reject ideas by formula.",
  "- Give meta-advice when it would help the group: identify what the workers did efficiently, what should continue, and what should improve in the next iteration. Relay that advice to the other workers or leader when the workflow allows it."
].join("\n");
