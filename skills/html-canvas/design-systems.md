# Using a design-system folder

A design system is the shared visual language of a product or organization: colors, type, spacing, components, assets, and examples of how they work together. When the user points to a folder, read its guidance and reuse the relevant pieces before inventing new styling. No registration or server-side storage is required.

A folder can be as simple as:

```text
brand/
  README.md       # usage, tone, accessibility, and layout guidance
  tokens.css      # palette, typography, spacing, radii
  assets/         # logos, images, locally licensed fonts
  components/     # optional reusable HTML/CSS or framework components
  examples/       # optional representative screens or documents
```

Start with README or the equivalent entrypoint, then open only the token files, assets, and examples relevant to this artifact. Follow the folder's actual structure; do not require these names or scan an entire project. Preserve supplied copy, logos, and token meanings. A brand folder can guide a report or deck as well as an app: use its type roles, palette, density, and imagery without copying app navigation into a document.

Copy the needed assets beside the generated HTML using relative URLs so preview and export can load them. Keep asset licenses intact. If guidance conflicts or a required asset is missing, name the specific gap. Do not create a design-system catalog, compiler, database, or management UI.
