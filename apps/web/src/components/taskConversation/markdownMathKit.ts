import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Loaded on demand: KaTeX is the largest piece of message rendering.
export const MATH_REHYPE_PLUGIN = rehypeKatex;
