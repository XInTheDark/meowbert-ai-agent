import assert from "node:assert/strict";
import path from "node:path";

async function measureConversation(page, sidebarWidth) {
  return page.evaluate((width) => {
    const shell = document.querySelector(".task-detail-conversation-shell");
    shell.classList.toggle("has-right-sidebar", width > 0);
    shell.classList.toggle("has-activity-sidebar", width > 0);
    shell.style.setProperty("--thread-sidebar-width", width + "px");
    const sidebar = document.querySelector(".tool-inspector-panel");
    document.querySelector(".thread-sidebar-resize-handle").hidden = width === 0;
    sidebar.hidden = width === 0;
    sidebar.style.display = width === 0 ? "none" : "";
    const main = document.querySelector(".task-detail-conversation-main").getBoundingClientRect();
    const feed = document.querySelector(".task-chat-feed");
    const composer = document.querySelector(".chat-input-container");
    const feedStyle = getComputedStyle(feed);
    const composerStyle = getComputedStyle(composer);
    return { mainLeft: main.left, mainWidth: main.width, feedWidth: feed.getBoundingClientRect().width,
      feedLeft: parseFloat(feedStyle.paddingLeft), feedRight: parseFloat(feedStyle.paddingRight),
      composerLeft: parseFloat(composerStyle.paddingLeft), composerRight: parseFloat(composerStyle.paddingRight),
      sidebarWidth: sidebar.getBoundingClientRect().width, documentWidth: document.documentElement.scrollWidth };
  }, sidebarWidth);
}

export async function verifyConversationLayout(page, screenshots) {
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    const main = document.createElement("main");
    main.className = "main-column task-detail-route";
    Object.assign(main.style, { width: "100vw", height: "100vh", padding: "0", margin: "0", display: "flex", flexDirection: "column" });
    main.innerHTML = '<div class="task-detail-chat-layout" style="display:flex;min-height:0">'
      + '<div class="task-detail-conversation-shell">'
      + '<div class="task-detail-conversation-main">'
      + '<div class="chat-feed task-chat-feed">'
      + '<article class="chat-bubble user"><div class="message-content">Test the sandbox here.<br>Write some files, make some network calls.</div></article>'
      + '<article class="chat-bubble assistant"><div class="markdown-content"><p>Worked for 49.0s · 9 calls</p>'
      + '<p>The sandbox successfully wrote the test files. The results are ready to review.</p>'
      + '<ul><li>sandbox_test.txt</li><li>sandbox_test.json</li><li>network_test.json</li></ul></div></article></div>'
      + '<div class="chat-input-container"><div class="chat-input-box"><textarea placeholder="Reply to the agent..."></textarea>'
      + '<div class="chat-controls"><div class="chat-controls-left">＋</div><div class="chat-controls-right">↑</div></div></div></div></div>'
      + '<div class="thread-sidebar-resize-handle" hidden></div>'
      + '<aside class="tool-inspector-panel tool-inspector-panel-docked" hidden><header class="tool-inspector-header">'
      + '<div class="tool-inspector-header-copy"><span class="tool-inspector-kicker">Activity</span><h2>Worked for 49.0s</h2></div></header>'
      + '<div class="tool-inspector-body"><section class="tool-inspector-section"><h3>run_shell</h3><pre>Writing test files and checking a network request</pre></section></div></aside></div></div>';
    document.body.replaceChildren(main);
  });
  for (const viewport of [1280, 1920]) {
    await page.setViewportSize({ width: viewport, height: 1000 });
    const closed = await measureConversation(page, 0);
    assert.equal(closed.mainWidth, 1120, "Closed-panel conversation must retain its existing width");
    assert.ok(Math.abs(closed.mainLeft - (viewport - 1120) / 2) <= 1, "Closed-panel conversation must stay centered");
    for (const width of [360, 560]) {
      const open = await measureConversation(page, width);
      assert.ok(open.feedLeft >= 20 && open.feedLeft <= 48, "Activity panel needs a modest adaptive conversation gutter");
      assert.equal(open.feedLeft, open.feedRight, "Conversation gutters must be balanced");
      assert.equal(open.feedLeft, open.composerLeft, "Reply box must align with the messages");
      assert.equal(open.feedRight, open.composerRight);
      assert.ok(Math.abs(open.mainWidth - (viewport - width - 10)) <= 1, "Gutters must preserve sidebar width");
      assert.ok(Math.abs(open.sidebarWidth - width) <= 1, "Activity panel must remain visible at its selected width");
      assert.ok(open.feedWidth - open.feedLeft - open.feedRight >= open.feedWidth * 0.85, "Keep most of the conversation width usable");
      assert.ok(open.documentWidth <= viewport, "The layout must not overflow horizontally");
    }
    if (viewport === 1920) await page.screenshot({ animations: "disabled", path: path.join(screenshots, "conversation-activity-open.png") });
    assert.deepEqual(await measureConversation(page, 0), closed, "Closing activity must restore the original layout");
    if (viewport === 1920) await page.screenshot({ animations: "disabled", path: path.join(screenshots, "conversation-activity-closed.png") });
  }
  console.log("Verified conversation layout at 1280/1920px: balanced adaptive activity gutters, aligned composer, preserved panel widths, unchanged closed layout.");
}
