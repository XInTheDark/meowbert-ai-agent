---
title: Canvas
summary: See and use the pages, visuals, and sites Meowbert builds, inline or beside the chat.
onboardingId: interactive-canvas
checklistLabel: Canvas
---

# Canvas

Canvas lets Meowbert show you designed documents and web pages: reports, proposals, charts, diagrams, calculators, interactive explanations, slide decks, dashboards, small apps, and whole sites.

## Turn it on

Open **Tools** in the Task Composer and turn on **Canvas**. It is on by default in new workspaces. Then ask for what you want to see, for example:

- "Chart these sales numbers and let me filter by region."
- "Build an interactive explainer for how TCP handshakes work."
- "Make a landing page for this product and keep it in the project."

## Inline and beside the chat

Meowbert picks where each canvas appears:

- **Inline** — small visuals sit inside the reply, sized to their content and matched to your light or dark theme.
- **Beside the chat** — pages, apps, decks, and sites open in a panel next to the conversation. The reply shows a card you can click to reopen it.

Hover over an inline canvas to open it beside the chat, reload it, or open it in a new browser tab. The panel has buttons to preview at full, tablet, or phone width, reload, open the canvas files, and close. Drag its edge to resize it.

When Meowbert changes a canvas, open views reload on their own and retain their scroll position while the panel stays open.

To ask about a specific part, click **Select an element** in the canvas panel, then click the heading, button, image, or section you mean. Type your request beneath the canvas and send it; Meowbert receives the selected element's context with your message. Selection does not edit the page directly. Press **Esc** or clear the selection to return to normal interaction.

To keep feedback for later, type it against the selection and click **Save comment**. Open **Comments** to review saved feedback, resolve or reopen a comment, or send it with **Ask Meowbert**. Saving a comment does not start an AI task. Comments sync across devices: project-canvas comments stay with that canvas across tasks, and one-off canvas comments stay with their task and file. They retain the selected text and element context; if the design changes, Meowbert uses that saved context to locate the corresponding source.

## Documents, design systems, and exports

Ask for a document in Canvas when you want to review its design beside the conversation: for example, "Create a three-page proposal in Canvas using the brand folder at `brand/`." A design-system folder can contain guidance, color and type tokens, logos, fonts, reusable components, and examples. Point Meowbert to the folder in your prompt; there is no separate setup step.

Documents can use A4, Letter, or Legal paper. The document shell offers **Fit** and **100%** views. Flowing documents are continuous onscreen and paginate when exported to PDF; explicitly composed pages have fixed page layouts. Decks keep their slide navigation and overview, while prototypes keep the tablet and phone preview controls.

Animations run in the live canvas. Ask for a **PDF** for a static, searchable document, or **standalone HTML** to keep supported static assets in one file. PDF capture freezes animations at a visible final frame; JavaScript timelines need an authored static frame. HTML keeps supported animation and interaction. External dependencies or framework modules may need to be bundled first. Native editable Word and PowerPoint documents still use their respective document tools.

## When something breaks

Meowbert opens every page before showing it to you and fixes the errors it finds. If a page still fails in your browser, the canvas says so instead of showing a blank box: you see the error, a **Retry** button, and a **Fix** button that sends the errors to Meowbert.

## Pages that ask Meowbert

A canvas can include buttons that ask Meowbert for more work, such as **Check my answer** or **Explain this step**. When you click one, the canvas shows exactly what it wants to send, and nothing is sent until you press **Send**.

Canvases never receive your account credentials. They run in an isolated sandbox, and anything they save in the browser (such as progress or settings) stays with that canvas.

## Project canvases

Most canvases belong to the task that made them. When you want a site you keep coming back to, ask Meowbert to keep it in the project. It becomes a **project canvas**, stored in the project's `canvases/` folder, that later tasks keep improving.

Project canvases are listed under **Canvases** in the project. **Open** shows the canvas beside its latest task, and **Continue** starts a new task for it. You can also attach a canvas from the attachment menu in any composer.

## Frameworks

Canvases are static web pages, so there is no server side. Meowbert can still use frameworks and npm packages: it builds them to plain HTML and shows the built page.
