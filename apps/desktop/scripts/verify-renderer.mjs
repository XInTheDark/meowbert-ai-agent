import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

function rendererEndpoint(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Renderer debugger did not start.")), 30_000);
    let output = "";
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output)?.[1];
      if (endpoint) { clearTimeout(timer); resolve(endpoint); }
    });
  });
}

async function stopApplication(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  child.kill();
  await exited;
  clearTimeout(timer);
}

function startServer() {
  return http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url === "/api/auth/registration") {
      response.end(JSON.stringify({ enabled: true, hasUsers: true, forgotPasswordEnabled: true }));
    } else if (request.url === "/api/auth/login") {
      response.writeHead(401).end(JSON.stringify({ error: "Renderer smoke sign-in rejected" }));
    } else response.end("{}");
  });
}

async function verifyStyles(page, theme) {
  await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
  const style = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const input = getComputedStyle(document.querySelector('input[type="email"]'));
    const button = getComputedStyle(document.querySelector("button.primary"));
    return { font: body.fontFamily, color: body.color, background: body.backgroundColor,
      inputPadding: parseFloat(input.paddingTop), buttonPadding: parseFloat(button.paddingTop),
      buttonBorder: parseFloat(button.borderRadius), buttonBackground: button.backgroundColor,
      themeColor: getComputedStyle(document.documentElement).getPropertyValue("--text").trim() };
  });
  assert.match(style.font, /sans-serif/i, "Shared UI typography must replace browser defaults");
  assert.ok(style.themeColor, "Theme variables must load");
  assert.notEqual(style.color, style.background, "Text must contrast with the page");
  assert.notEqual(style.color, "rgb(0, 0, 0)", "Theme text must replace browser defaults");
  assert.ok(style.inputPadding >= 8 && style.buttonPadding >= 6 && style.buttonBorder > 0, "Shared form controls must be styled");
  assert.notEqual(style.buttonBackground, "rgba(0, 0, 0, 0)");
  return style;
}

async function main() {
  const executablePath = path.resolve(process.argv[2]);
  const screenshots = path.resolve(process.argv[3] ?? "apps/desktop/dist-packages/renderer-checks");
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-renderer-"));
  const server = startServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  await fs.writeFile(path.join(userData, "desktop-state.json"), JSON.stringify({
    authToken: { mode: "none", value: null },
    serverProfilesState: { activeProfileId: "smoke", profiles: [{ id: "smoke", label: "Renderer smoke test", mode: "remote", baseUrl }] },
    shortcutPreferences: { quickAgent: null, commandPalette: null, newTask: null, uploadFiles: null, revealFolder: null }
  }));
  await fs.mkdir(screenshots, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let application;
  let browser;
  let page;
  try {
    application = spawn(executablePath, ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + userData], { env, stdio: ["ignore", "ignore", "pipe"] });
    browser = await chromium.connectOverCDP(await rendererEndpoint(application));
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? await context.waitForEvent("page");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
        page.on("requestfailed", (request) => { if (request.url().startsWith("file:")) errors.push("Failed packaged asset: " + request.url()); });
    await page.locator('input[type="email"]').waitFor({ state: "visible" });
    const state = JSON.parse(await fs.readFile(path.join(userData, "desktop-state.json"), "utf8"));
    assert.ok(state.localExecutionSettingsByServer?.[baseUrl], "The app must use the isolated test profile");
    const desktop = await page.evaluate(async () => {
      const bridge = window.meowbertDesktop;
      return bridge ? { capabilities: bridge.capabilities, profiles: (await bridge.getBootstrapData()).serverProfilesState.profiles } : null;
    });
    assert.ok(desktop?.capabilities.isDesktop, "The sandboxed desktop preload must load");
    assert.equal(desktop.profiles[0].baseUrl, baseUrl, "The renderer must use the selected desktop server");
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ["dark", "light"]) {
      console.log(theme, await verifyStyles(page, theme));
      await page.screenshot({ animations: "disabled", path: path.join(screenshots, "login-" + theme + ".png") });
    }
    await page.locator('input[type="email"]').fill("renderer@example.test");
    await page.locator('input[type="password"]').fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Renderer smoke sign-in rejected", { exact: false }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Login must fit narrow windows");
    await page.screenshot({ animations: "disabled", path: path.join(screenshots, "login-narrow.png") });
    assert.deepEqual(errors, [], "Renderer must not throw JavaScript errors");
    console.log("Verified actual packaged login: light/dark styles, fonts, form interaction, and narrow layout.");
  } catch (error) {
    if (page) await page.screenshot({ animations: "disabled", path: path.join(screenshots, "failure.png") }).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close();
    await stopApplication(application);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(userData, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
