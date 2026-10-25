import assert from "node:assert/strict";
import path from "node:path";

const workspace = { id: "smoke-workspace", name: "Smoke workspace" };
const project = { id: "smoke-project", name: "Smoke project", workspace_id: workspace.id };
const file = { name: "notes.txt", relativePath: "notes.txt", kind: "file", sizeBytes: 5, createdAt: null, modifiedAt: null };

export function createQuickAgentSmokeFixture() {
  const createdTasks = [];
  let rejectedSubmission = false;
  const responses = {
    "/api/auth/me": { user: { id: "smoke-user", email: "renderer@example.test", is_super_admin: false }, workspaces: [workspace] },
    "/api/skills": { skills: [] },
    "/api/agents": { agents: [], defaultAgentId: null },
    "/api/workspaces/smoke-workspace/projects": { items: [project] },
    "/api/workspaces/smoke-workspace/settings": { memoryEnabled: false },
    "/api/workspaces/smoke-workspace/sources": { sources: [] },
    "/api/workspace-files/location": { fileHost: { kind: "server" } },
    "/api/projects/smoke-project/files": { cwd: "", parentPath: null, items: [file] },
    "/api/projects/smoke-project/files/content": { relativePath: file.relativePath, sizeBytes: 5, truncated: false, encoding: "utf-8", text: "notes" }
  };
  return { createdTasks, handleRequest(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/api/projects/smoke-project/tasks" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        if (!rejectedSubmission) {
          rejectedSubmission = true;
          response.writeHead(503).end(JSON.stringify({ error: "Smoke submission temporarily unavailable" }));
        } else {
          createdTasks.push({ body: JSON.parse(body), authorization: request.headers.authorization });
          response.end(JSON.stringify({ taskId: "smoke-task" }));
        }
      });
    } else if (Object.hasOwn(responses, pathname)) response.end(JSON.stringify(responses[pathname]));
    else return false;
    return true;
  } };
}

export async function verifyQuickAgent(context, mainPage, screenshots, fixture) {
  const errors = [];
  const collectErrors = (page) => page.on("pageerror", (error) => errors.push(error.message));
  context.on("page", collectErrors);
  let quick;
  try {
    const opened = context.waitForEvent("page");
    await mainPage.evaluate(() => window.meowbertDesktop.showQuickAgent());
    quick = await opened;
    await quick.getByRole("heading", { name: "Sign in to use Quick Agent" }).waitFor();
    await mainPage.evaluate(() => window.meowbertDesktop.saveAuthToken("quick-smoke-token"));
    await quick.reload();
    const input = quick.getByPlaceholder("Ask Bert to handle something…");
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await quick.waitForFunction(() => document.querySelector('select[aria-label="Project"]')?.value === "smoke-project");
    assert.equal(await quick.getByRole("combobox", { name: "Workspace", exact: true }).inputValue(), workspace.id);
    assert.equal(await input.evaluate((element) => document.activeElement === element), true, "Quick Agent must focus its composer");
    const regions = await quick.evaluate(() => ({
      pill: document.querySelector(".quick-agent-drag-pill") !== null,
      toolbar: getComputedStyle(document.querySelector(".quick-agent-toolbar")).getPropertyValue("-webkit-app-region"),
      input: getComputedStyle(document.querySelector(".quick-agent-composer")).getPropertyValue("-webkit-app-region"),
      select: getComputedStyle(document.querySelector("select")).getPropertyValue("-webkit-app-region")
    }));
    assert.deepEqual(regions, { pill: false, toolbar: "drag", input: "no-drag", select: "no-drag" }, "Quick Agent must remain draggable without obstructing its controls");
    for (const theme of ["dark", "light"]) {
      await quick.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await quick.screenshot({ animations: "disabled", path: path.join(screenshots, "quick-agent-" + theme + ".png") });
    }
    await quick.setViewportSize({ width: 920, height: 460 });
    await quick.getByRole("button", { name: "Attach files", exact: true }).click();
    await quick.getByRole("menuitem", { name: "From project" }).click();
    const picker = quick.getByRole("dialog", { name: "Project files" });
    await picker.getByText("notes.txt", { exact: true }).click();
    await picker.getByRole("button", { name: "Attach selected" }).click();
    await picker.waitFor({ state: "hidden" });
    await input.fill("Quick Agent smoke task");
    await input.press("Enter");
    await quick.getByText("Smoke submission temporarily unavailable", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "Quick Agent smoke task", "Submission errors must retain the draft");
    const created = quick.waitForResponse((response) => response.url().endsWith("/api/projects/smoke-project/tasks") && response.status() === 200);
    await quick.getByRole("button", { name: "Send message", exact: true }).click();
    await created;
    await quick.waitForFunction(() => document.querySelector("textarea")?.value === "");
    assert.equal(fixture.createdTasks.length, 1);
    assert.equal(fixture.createdTasks[0].authorization, "Bearer quick-smoke-token");
    assert.match(fixture.createdTasks[0].body.message, /Quick Agent smoke task/);
    assert.equal(fixture.createdTasks[0].body.attachments[0].relativePath, file.relativePath);
    const bootstrap = await mainPage.evaluate(() => window.meowbertDesktop.getBootstrapData());
    assert.deepEqual(bootstrap.activeContext, { workspaceId: workspace.id, environmentId: project.id });
    await mainPage.evaluate(() => window.meowbertDesktop.showQuickAgent());
    await quick.waitForFunction(() => document.activeElement === document.querySelector("textarea"));
    assert.deepEqual(errors, [], "Quick Agent must not crash");
    await quick.getByRole("button", { name: "Close Quick Agent" }).click();
    console.log("Verified packaged Quick Agent: sign-in state, authenticated composer, focus, themes, project files, error recovery, and task creation.");
  } catch (error) {
    if (quick) await quick.screenshot({ path: path.join(screenshots, "quick-agent-failure.png") }).catch(() => undefined);
    throw new Error("Quick Agent verification failed. Renderer errors: " + errors.join("; "), { cause: error });
  } finally {
    context.off("page", collectErrors);
  }
}
