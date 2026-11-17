/**
 * Job Search's assistant view in the kit's strict MCP Apps test host, the way
 * the kit checks its own apps (tests/mcp-apps.ts): a scripts-only sandbox whose
 * page may not reach the network, Ri's rules where MCP Apps leaves room (view-only
 * tools kept from the model, drafts never sent, links and files recorded, deep
 * links), and a host that can do none of that.
 *
 * Run `pnpm build`, then `pnpm test:host`. It serves the built app on a free port
 * with a disposable data directory and the fictional preview, and stops it after.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect as baseExpect, type Page } from "@playwright/test";
import { serveApp, createTestConnection } from "@app-builder/core/node";
import type { HostOptions } from "./browser-host";

const root = path.resolve(import.meta.dirname, "../..");
if (!fs.existsSync(path.join(root, "dist/mcp.html"))) throw new Error("Build the app first: pnpm build");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-search-host-"));
process.env.APP_DATA_DIR = dataDir;
const { application } = await import("../../src/app.js");
// The kit's browser tests wait up to 20 seconds (playwright.config.ts).
const expect = baseExpect.configure({ timeout: 20000 });
const VIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
type Message = { role: string; content: { type: string; text: string }[]; _meta?: Record<string, unknown> };
type Download = { contents: { type: string; resource: { uri: string; mimeType: string; text?: string } }[] };

const running = await serveApp(application, { root, dataDir, port: 0 });
const origin = running.platform.baseURL;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome } : {});
let passed = 0;
const step = async (name: string, work: () => Promise<void>) => { await work(); passed++; console.log(`  ✓ ${name}`); };

try {
  // The fictional preview, loaded from the person's own browser.
  const seeded = await fetch(`${origin}/api/trpc/run`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ name: "load_preview", input: {} }) });
  if (!seeded.ok) throw new Error(`The preview didn't load: ${seeded.status} ${await seeded.text()}`);
  const { accessToken: token } = await createTestConnection(running.platform, { name: "Qualification host" });

  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) failures.push(message.text()); });
  page.on("request", (request) => { if (request.frame().parentFrame() && !request.url().endsWith("/__mcp-view__")) failures.push("The view reached the network: " + request.url()); });
  const resource = await (await fetch(origin + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "ui://job-search/main" } }) })).json() as { result: { contents: { text: string; _meta: { ui: { csp: unknown } } }[] } };
  expect(resource.result.contents[0]._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
  await page.route("**/__mcp-view__", (route) => route.fulfill({ contentType: "text/html", headers: { "content-security-policy": VIEW_CSP }, body: resource.result.contents[0].text }));
  await page.route("**/__mcp-host__", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>MCP Apps test host</title><body style='margin:0'></body>" }));
  const bundle = await build({ entryPoints: [path.join(import.meta.dirname, "browser-host.ts")], bundle: true, write: false, format: "iife", platform: "browser" });
  await page.goto(origin + "/__mcp-host__");
  await page.evaluate((value) => { (window as unknown as { mcpToken: string }).mcpToken = value; }, token);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const host = hostOf(page);
  // The view's tool calls go through the host page: wait until none has started for a second.
  let lastCall = Date.now();
  page.on("request", (request) => { if (request.url().endsWith("/mcp")) lastCall = Date.now(); });
  const quiet = async () => { await expect.poll(() => Date.now() - lastCall, { intervals: [250] }).toBeGreaterThan(1000); };
  const view = page.frameLocator("#app-frame");
  const result = <T>(value: Result) => (value.structuredContent as { result: T }).result;
  const list = result<{ items: { id: string; company: string; role: string }[] }>(await host.appCall("list_opportunities", { view: "active" })).items;
  const northstar = list.find((item) => item.company === "Northstar")!, lumen = list.find((item) => item.company === "Lumen")!;
  const interview = result<{ items: { id: string; title: string; meetingLink: string | null }[] }>(await host.appCall("list_interviews", { upcoming: true })).items[0];

  await step("the person's own decisions are kept from the host's model, and the view can still call them", async () => {
    const forModel = await host.modelTools();
    for (const name of ["resolve_match", "delete_source_data", "delete_import", "preview_import", "apply_import", "export_records", "set_source", "continue_import", "set_stage_tracking", "suggest_preparation", "archive_material", "load_preview", "clear_preview", "search_mentions"])
      expect(forModel, name).not.toContain(name);
    for (const name of ["list_opportunities", "get_opportunity", "change_stage", "show_opportunities", "open_job_search"]) expect(forModel).toContain(name);
    expect((await host.call("export_records", {})).isError).toBe(true);
    expect((await host.appCall("export_records", {})).isError).toBeFalsy();
  });

  await step("a card opens the whole app at one opportunity, and the place and selection reach the assistant", async () => {
    await host.mount("show_opportunities", { view: "active" });
    await expect(view.locator(".view-row")).toHaveCount(5);
    await view.getByRole("button", { name: `Open ${northstar.company} · ${northstar.role}` }).click();
    await expect.poll(host.displayMode).toBe("fullscreen");
    await expect(view.getByRole("heading", { name: northstar.role, exact: true })).toBeVisible();
    await expect.poll(host.modelContext).toContain('"section":"An opportunity"');
    expect(await host.modelContext()).toContain(`"path":"/opportunities/${northstar.id}`);
    expect(await host.modelContext()).toContain(`"selected":{"id":"${northstar.id}","title":"Northstar · Product designer"}`);
  });

  await step("open_job_search opens at a path, and a host link moves the open app", async () => {
    await host.mount("open_job_search", { path: `/opportunities/${lumen.id}` });
    await expect(view.getByRole("heading", { name: lumen.role, exact: true })).toBeVisible();
    await host.deepLink(`/interviews/${interview.id}`);
    await expect(view.getByRole("heading", { name: `Prepare for ${interview.title}` })).toBeVisible();
    await expect.poll(host.modelContext).toContain('"section":"Interview preparation"');
    await host.mount("open_job_search", {}, { deepLink: `/opportunities/${northstar.id}` });
    await expect(view.getByRole("heading", { name: northstar.role, exact: true })).toBeVisible();
  });

  await step("Ask Ri drafts the question in the chat, never sent", async () => {
    await host.mount("open_job_search", { path: "/today" });
    await view.getByRole("button", { name: "Draft with Ri" }).first().click();
    await expect.poll(async () => (await host.asked()).messages.length).toBe(1);
    const [message] = (await host.asked()).messages;
    expect(message).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("Draft editable text only") }] });
    expect(message._meta).toEqual({ "openai/message": { target: "active", send: false } });
  });

  await step("a meeting link and Open in browser go out through the host", async () => {
    await view.getByRole("button", { name: "Open meeting link" }).first().click();
    await expect.poll(async () => (await host.asked()).links).toContain(interview.meetingLink!);
    await view.getByRole("button", { name: "Open in browser" }).first().click();
    await expect.poll(async () => (await host.asked()).links.some((link) => link.startsWith(origin + "/today"))).toBe(true);
  });

  await step("exporting saves a file through the host, and a review decision works from the view", async () => {
    await view.getByRole("tab", { name: /^Sources/ }).click();
    // Wait for Sources to finish loading, so nothing re-renders under the click.
    await expect(view.getByRole("heading", { name: "Your accounts through Ri" })).toBeVisible();
    await quiet();
    // From the keyboard: in this headless Chrome a pointer click doesn't reach an element the
    // sandboxed frame had to scroll to (the frame scrolls, and a dispatched click works).
    await view.getByRole("button", { name: "Export your records" }).press("Enter");
    await expect.poll(async () => (await host.asked()).downloads.length).toBe(1);
    const [file] = (await host.asked()).downloads;
    expect(file.contents[0]).toMatchObject({ type: "resource", resource: { mimeType: "application/json", uri: expect.stringMatching(/^file:\/\/\/job-search-export-.*\.json$/) } });
    expect(file.contents[0].resource.text).toContain("Northstar");
    const before = result<{ items: unknown[] }>(await host.appCall("list_review", {})).items.length;
    await view.getByRole("button", { name: "Ignore" }).first().press("Enter");
    await expect.poll(async () => result<{ items: unknown[] }>(await host.appCall("list_review", {})).items.length).toBe(before - 1);
  });

  await step("in a host that can't draft, open links or save files, nothing is sent and the view offers what it can", async () => {
    const before = await host.asked();
    await host.mount("open_job_search", { path: "/today" }, { draft: false, openLinks: false, download: false });
    await expect(view.getByRole("button", { name: "Open meeting link" }).first()).toBeVisible();
    await expect(view.getByRole("button", { name: "Open in browser" })).toHaveCount(0);
    await view.getByRole("button", { name: "Draft with Ri" }).first().click();
    await expect(view.getByRole("dialog", { name: "Ask your assistant" })).toBeVisible();
    await view.getByRole("button", { name: "Close dialog" }).click();
    await view.getByRole("button", { name: "Open meeting link" }).first().click();
    await expect(view.getByText(`Open this link in your browser: ${interview.meetingLink}`)).toBeVisible();
    expect(await host.asked()).toEqual(before);
  });

  await step("the @ menu finds records as the connection, and the host reads one", async () => {
    const found = await host.appCall("search_mentions", { query: "north" });
    const items = (found.structuredContent as { items: { uri: string }[] }).items;
    expect(items.map((item) => item.uri)).toContain(`app://job-search/opportunities/${northstar.id}`);
  });

  expect(failures).toEqual([]);
  console.log(`Job Search's view passed ${passed} checks in the strict test host.`);
} finally {
  await browser.close();
  await running.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function hostOf(page: Page) {
  return {
    mount: (tool: string, input: Record<string, unknown> = {}, options: HostOptions = {}) =>
      page.evaluate(([tool, input, options]) => window.mcpFixture.mount("/__mcp-view__", tool, input, options), [tool, input, options] as const) as Promise<Result>,
    call: (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.call(name, input), [name, input] as const) as Promise<Result>,
    appCall: (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.appCall(name, input), [name, input] as const) as Promise<Result>,
    modelTools: () => page.evaluate(() => window.mcpFixture.modelTools()),
    deepLink: (url: string) => page.evaluate((url) => window.mcpFixture.deepLink(url), url),
    asked: () => page.evaluate(() => ({ messages: window.mcpFixture.messages, links: window.mcpFixture.links, downloads: window.mcpFixture.downloads })) as Promise<{ messages: Message[]; links: string[]; downloads: Download[] }>,
    modelContext: () => page.evaluate(() => ((window.mcpFixture.context as { content?: { text?: string }[] } | null)?.content ?? []).map((part) => part.text ?? "").join("\n")),
    displayMode: () => page.evaluate(() => window.mcpFixture.displayMode),
  };
}
