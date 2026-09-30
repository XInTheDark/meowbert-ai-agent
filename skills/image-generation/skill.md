# Image Generation

Generate or edit raster images through the configured OpenAI-compatible provider and save the final file in the current task directory.

The provider configuration, API key handling, and both endpoints remain in `image-generation.config.json` and `server.mjs`:

- `generate_image` calls `/images/generations` for a new image.
- `edit_image` calls `/images/edits` for edits, compositing, and reference-image work.

## Tool controls

Both tools accept a caller-provided `model`; when omitted, they use the configured provider model, which defaults to `gpt-image-2.5-sunburst`. Model IDs are passed to the configured endpoint without a local allowlist.

Both tools generate one output per call and accept:

- `prompt` and `filename`
- `model`
- `quality`: `low`, `medium`, `high`, `xhigh`, `max`, or `auto`
- `size`: omit it to let the provider choose, or use a concrete `WIDTHxHEIGHT` when composition requires it
- `background`: `transparent`, `opaque`, or `auto`
- `output_format`: `png`, `jpeg`, or `webp`
- `output_compression` for JPEG or WebP output

Start with `quality: "high"`. Inspect the result before increasing to `xhigh` or `max`; use those settings only when a concrete quality problem remains.

`edit_image` additionally accepts:

- `image_paths`: one or more task-relative source or reference images
- `mask_path`: an optional transparent mask that applies to the first source image
- `input_fidelity`: `low` or `high` when supported by the selected model

The server always sends `moderation: "low"`; it is not a tool parameter. Paths are resolved inside the task directory. Describe every supplied image's role in the prompt, in input order.

## When to use

- Generate a new image: concept art, product shot, cover, website hero, UI mockup, or infographic.
- Generate or edit with one or more reference images for style, composition, mood, or subject guidance.
- Edit an existing image: inpainting, lighting or weather changes, background replacement, object removal, compositing, or a transparent-background cutout.

## When not to use

- Extending or matching an existing SVG/vector icon set, logo system, or illustration library inside the repo.
- Creating simple shapes, diagrams, wireframes, or icons that are better produced directly in SVG, HTML/CSS, or canvas.
- Making a small project-local asset edit when the source file already exists in an editable native format.
- Any task where the user clearly wants deterministic code-native output instead of a generated bitmap.

## Decision tree

Think about two separate questions:

1. Is this a new image or an edit of an existing image?
2. Does the output need an exact size, quality setting, transparency, reference image, or mask?

- Use `generate_image` when the user provides no images or only wants a wholly new image.
- Use `edit_image` when any task image must be preserved, changed, combined, or used as a direct visual reference.
- For each input image, state whether it is the edit target, a style reference, or a supporting insert/compositing input.
- Use a concrete `size` only when the intended output needs an exact aspect ratio or dimensions. Otherwise omit it and let the configured provider choose.
- Preserve invariants aggressively in edits: say exactly what may change and what must remain unchanged.

## Workflow

1. Decide whether to generate or edit.
2. Collect the prompt, exact text to appear in the image, constraints, avoid items, and relevant task image paths.
3. Choose a concrete size only when it materially affects the result. Otherwise omit `size`.
4. Start with `quality: "high"`.
5. For every input image, label its role in the prompt by order.
6. Generate or edit with the corresponding MCP tool and save to a descriptive task-relative filename.
7. Inspect the output with `view_image` when image quality matters.
8. If the result is unsatisfactory, make one targeted prompt or control change and retry. Increase quality to `xhigh` or `max` only when higher detail or editing precision is the missing factor.
9. Mark the selected final image as an artifact when it is a deliverable.

## Prompt augmentation

Reformat the user's prompt into a structured production spec. Preserve specific user requirements; add detail only when it materially improves the result.

Use this scaffolding when useful:

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

Keep the prompt short. For edits, explicitly list invariants such as `change only X; keep Y unchanged`. For multi-image edits, reference images by index and state how each should be used.

## Use-case taxonomy

Generate:

- `photorealistic-natural`: candid/editorial lifestyle scenes with natural texture and lighting
- `product-mockup`: product, packaging, catalog, or merch concepts
- `ui-mockup`: app or web-interface mockups and wireframes
- `infographic-diagram`: diagrams and infographics with structured layout and exact text
- `scientific-educational`: classroom explainers and scientific diagrams
- `ads-marketing`: campaign concepts and ad creatives
- `productivity-visual`: slide, chart, workflow, and data-heavy visuals
- `logo-brand`: logo and mark exploration
- `illustration-story`: comics, children's-book art, and narrative scenes
- `stylized-concept`: style-driven concept art and 3D renders
- `historical-scene`: period-accurate scenes

Edit:

- `text-localization`: translate or replace image text while preserving layout
- `identity-preserve`: preserve a person's face, body, and pose
- `precise-object-edit`: remove or replace a specified element
- `lighting-weather`: change time, season, or atmosphere only
- `background-extraction`: transparent background or clean cutout
- `style-transfer`: apply a reference style while changing subject or scene
- `compositing`: merge images with matched lighting and perspective
- `sketch-to-render`: turn a drawing or line art into a rendered image

## Prompting best practices

- Structure prompts as scene/backdrop, subject, details, then constraints.
- Include intended use to establish the appropriate style and polish.
- Use camera and composition language for photorealism.
- Quote exact text and specify typography and placement.
- For tricky words, spell them letter by letter and require verbatim rendering.
- Do not add characters, objects, brands, slogans, palettes, or narrative beats that the user did not imply.
- For edits, repeat invariants on every iteration.
- When the prompt is generic, add only the detail needed to improve the output materially. When it is already detailed, normalize it instead of expanding it.
