---
title: Canvas
summary: See and use the pages, visuals, and sites Meowbert builds, inline or beside the chat.
onboardingId: interactive-canvas
checklistLabel: Canvas
---

# Canvas

Canvas lets Meowbert show you web pages instead of only describing them: charts, diagrams, calculators, interactive explanations, slide decks, dashboards, small apps, and whole sites.

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

When Meowbert changes a canvas, open views reload on their own.

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
