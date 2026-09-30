import { describe, expect, it } from "vitest";
import { normalizeLatexDelimiters } from "./normalizeLatexDelimiters";

describe("normalizeLatexDelimiters", () => {
  it("normalizes multiline $$ ... $$ display math into isolated blocks", () => {
    const input = [
      "In Step 5 of your handout, you mix 10 mL of acid stock with 10 mL of base stock. Since you have made their concentrations equal, the intended calculation is:",
      "",
      "$$\\mathrm{pH}=\\mathrm{p}K_a+\\log\\left(\\frac{[\\mathrm{P^{2-}}]}{[\\mathrm{HP^-}]}\\right) =\\mathrm{p}K_a+\\log(1)",
      "=\\mathrm{p}K_a$$",
      "",
      "**So the procedure is deliberately designed to let you estimate the pKa by measuring that mixture's pH.**"
    ].join("\n");

    const normalized = normalizeLatexDelimiters(input);

    // The display math fence must be on its own line
    expect(normalized).toContain("\n$$\n");
    expect(normalized).toContain(
      "\\mathrm{pH}=\\mathrm{p}K_a+\\log\\left(\\frac{[\\mathrm{P^{2-}}]}{[\\mathrm{HP^-}]}\\right) =\\mathrm{p}K_a+\\log(1)\n=\\mathrm{p}K_a"
    );
    // Closing fence must be followed by normal markdown
    expect(normalized).toContain(
      "**So the procedure is deliberately designed to let you estimate the pKa by measuring that mixture's pH.**"
    );
  });

  it("normalizes \\[ ... \\] display math into isolated $$ blocks", () => {
    const input = "Formula:\n\\[\n\\frac{a}{b} = c\n\\]\nDone.";
    const normalized = normalizeLatexDelimiters(input);

    expect(normalized).toContain("\n$$\n\\frac{a}{b} = c\n$$\n");
    expect(normalized).toContain("Done.");
  });

  it("normalizes \\( ... \\) inline math into $$...$$ inline math", () => {
    const input = "Let \\(x = 1\\) and \\(y = 2\\) be integers.";
    const normalized = normalizeLatexDelimiters(input);

    expect(normalized).toBe("Let $$x = 1$$ and $$y = 2$$ be integers.");
  });

  it("preserves $$ and math delimiters inside fenced code blocks and inline code", () => {
    const input = [
      "Here is bash code:",
      "```bash",
      "echo $$ # PID",
      "echo \"\\[test\\]\"",
      "```",
      "And inline `echo $$` and `\\[0\\]`.",
      "",
      "And actual math:",
      "\\[ x = 1 \\]"
    ].join("\n");

    const normalized = normalizeLatexDelimiters(input);

    expect(normalized).toContain("```bash\necho $$ # PID\necho \"\\[test\\]\"\n```");
    expect(normalized).toContain("`echo $$`");
    expect(normalized).toContain("`\\[0\\]`");
    expect(normalized).toContain("\n$$\nx = 1\n$$\n");
  });

  it("escapes unmatched $$ at line starts to prevent unclosed fences from swallowing text", () => {
    const input = [
      "First paragraph.",
      "",
      "$$ x = 1",
      "",
      "### Next section",
      "Normal text."
    ].join("\n");

    const normalized = normalizeLatexDelimiters(input);

    expect(normalized).toContain("\\$\\$ x = 1");
    expect(normalized).toContain("### Next section");
  });

  it("normalizes standalone \\begin{equation} blocks into display math", () => {
    const input = "Equation:\n\\begin{equation}\nE = mc^2\n\\end{equation}\nNext.";
    const normalized = normalizeLatexDelimiters(input);

    expect(normalized).toContain("\n$$\n\\begin{equation}\nE = mc^2\n\\end{equation}\n$$\n");
  });

  it("handles empty or whitespace strings gracefully", () => {
    expect(normalizeLatexDelimiters("")).toBe("");
    expect(normalizeLatexDelimiters("   ")).toBe("   ");
  });
});
