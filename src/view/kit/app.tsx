/**
 * The screens were written against Ri's view host (`useRiApp()`). This
 * provider gives them the same interface on App Builder's client, in the
 * person's browser and inside an assistant (MCP Apps):
 *
 * - `call` runs an action through the core (tRPC in the browser, host tool
 *   calls in an assistant). A write's invocation ID becomes its operationId,
 *   so "Try again" repeats the same logical write.
 * - The place (section, record, filters) is the router's address: the
 *   browser's, or the view's own memory router in an assistant.
 * - `data` is the app's setup state (get_view_state) plus that place.
 * - What Ri's host did itself has no MCP Apps or core equivalent here, and
 *   works differently (docs/parity.md): "Ask Ri" shows the question to copy
 *   into the chat, Sources and access open the app's own screens, links and
 *   downloads work in the browser only.
 */
import { createContext, useCallback, useContext, useEffect, useInsertionEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAppClient } from "@app-builder/core/react";
import { LiveRegion } from "./announce.js";
import { Dialog } from "./dialog.js";
import { Button } from "./button.js";
import { installStyles } from "./styles.js";
import { clampText, errorMessage } from "./util.js";

export type Theme = "light" | "dark";
export interface SelectedFile { name: string; mimeType: string; base64: string }
export interface DownloadRequest {
  /** File name such as `job-search-export.json`. Path separators are removed. */
  name: string;
  mimeType: string;
  /** Text content. Provide exactly one of `text` or `base64`. */
  text?: string;
  /** Base64 content for binary files. */
  base64?: string;
}

export interface RiApp<TData = unknown> {
  data: TData | undefined;
  revision: number;
  theme: Theme;
  connected: boolean;
  error: string | null;
  /** True inside an assistant's view, where links, downloads and some actions need the browser. */
  embedded: boolean;
  call<T = unknown>(action: string, input?: Record<string, unknown>, options?: { invocationId?: string }): Promise<T>;
  /** The selected record, for the assistant's next message (the core's bounded selection). */
  context(state: unknown): void;
  /** Show a question for the person to ask their assistant. Never sends. */
  ask(prompt: string): Promise<void>;
  openSources(): Promise<void>;
  manageAccess(): Promise<void>;
  setLocation(path: string, options?: { replace?: boolean; push?: boolean }): void;
  goBack(fallback: string): void;
  moves: number;
  openExternal(url: string): Promise<void>;
  openDirections(address: string): Promise<void>;
  selectFile(): Promise<SelectedFile | null>;
  download(file: DownloadRequest): Promise<void>;
  /** Tell the assistant what the person changed, and refresh what the screens show. */
  changed(summary: string): void;
}

const RiAppContext = createContext<RiApp | null>(null);
const MovesContext = createContext<{ follow(listener: (data: unknown) => void): () => void } | null>(null);

export function useRiApp<TData = unknown>(): RiApp<TData> {
  const value = useContext(RiAppContext);
  if (!value) throw new Error("useRiApp needs a RiAppProvider above this component");
  return value as RiApp<TData>;
}
export function useOptionalRiApp<TData = unknown>(): RiApp<TData> | null {
  return useContext(RiAppContext) as RiApp<TData> | null;
}
/** Move the screens when the address moves without them, as with Back and Forward. */
export function useLocationMoves<TData = unknown>(onMove: (data: TData) => void) {
  const moves = useContext(MovesContext);
  if (!moves) throw new Error("useLocationMoves needs a RiAppProvider above this component");
  const handler = useRef(onMove);
  useInsertionEffect(() => { handler.current = onMove; });
  useEffect(() => moves.follow((data) => handler.current(data as TData)), [moves]);
}

export const MAX_PROMPT_LENGTH = 2000;
export function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("This link is not a valid web address"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Only secure https links can open from this app");
  return parsed.href;
}
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

function base64Of(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export interface RiAppProviderProps {
  children: ReactNode;
  /** The setup state action the screens open with. */
  stateAction: string;
  /** The opener data the screens read: setup state plus the current place. */
  toData(state: unknown, path: string, query: Record<string, string>): unknown;
  /** Global CSS for the app's screens, installed once on the client. */
  css?: string;
}

export function RiAppProvider({ children, stateAction, toData, css }: RiAppProviderProps) {
  const client = useAppClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<unknown>(undefined);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [moves, setMoves] = useState(0);
  const listeners = useRef(new Set<(data: unknown) => void>());
  /** The address the screens set themselves. Any other change is a move (Back, Forward, a link). */
  const expected = useRef<string | null>(null);
  const depth = useRef(0);

  useInsertionEffect(() => { installStyles(css); }, [css]);
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    try { setState(await client.call(stateAction, {})); setError(null); }
    catch (failure) { setError(errorMessage(failure, "Job Search could not open. Try again.")); }
  }, [client, stateAction]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const update = () => { setRevision((value) => value + 1); void load(); };
    window.addEventListener("app-data-changed", update);
    return () => window.removeEventListener("app-data-changed", update);
  }, [load]);

  const query = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);
  const data = useMemo(() => (state === undefined ? undefined : toData(state, location.pathname, query)), [state, location.pathname, query, toData]);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    const here = location.pathname + location.search;
    if (expected.current === here) { expected.current = null; return; }
    if (dataRef.current === undefined) return;
    setMoves((value) => value + 1);
    for (const listener of listeners.current) listener(dataRef.current);
  }, [location.pathname, location.search]);

  const selected = useRef<string | null>(null);
  const actions = useMemo(() => ({
    async call<T>(action: string, input: Record<string, unknown> = {}, options: { invocationId?: string } = {}) {
      const body = options.invocationId && !("operationId" in input) ? { ...input, operationId: options.invocationId } : input;
      return client.call<T>(action, body);
    },
    context(value: unknown) {
      // The core sends a fixed, bounded shape: the one selected record's id and title.
      const pick = (value as { selected?: { id: string; title?: string }[] } | null)?.selected?.[0];
      const key = pick ? `${pick.id}|${pick.title ?? ""}` : null;
      if (key === selected.current) return;
      selected.current = key;
      client.select(pick ? { id: pick.id, title: clampText(pick.title ?? "Selected record", 120) } : null);
    },
    async ask(prompt: string) { setAsking(clampText(prompt, MAX_PROMPT_LENGTH)); },
    async openSources() { expected.current = "/sources"; depth.current++; navigate("/sources"); },
    async manageAccess() {
      if (client.embedded) setNotice("Which assistants may use Job Search, and what each may see, is in Job Search's Settings in your browser.");
      else window.location.assign("/settings");
    },
    setLocation(path: string, options: { replace?: boolean; push?: boolean } = {}) {
      const current = window.location.pathname + window.location.search;
      if (client.embedded ? false : path === current) return;
      const samePath = path.split("?")[0] === location.pathname;
      const replace = options.replace || (!options.push && samePath);
      expected.current = path;
      if (!replace) depth.current++;
      navigate(path, { replace });
    },
    goBack(fallback: string) {
      if (depth.current > 0) { depth.current--; navigate(-1); }
      else { expected.current = fallback; navigate(fallback, { replace: true }); }
    },
    async openExternal(url: string) {
      const href = assertHttpsUrl(url);
      if (client.embedded) { setNotice(`Open this link in your browser: ${href}`); return; }
      window.open(href, "_blank", "noopener,noreferrer");
    },
    async openDirections(address: string) { await this.openExternal(directionsUrl(address)); },
    selectFile() {
      return new Promise<SelectedFile | null>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,.docx,.txt,.md,.html,.htm,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html,text/csv";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          if (file.size > 512 * 1024) return reject(new Error("Choose a file up to 512 KB"));
          const type = file.type || (/\.md$/i.test(file.name) ? "text/markdown" : /\.csv$/i.test(file.name) ? "text/csv" : /\.html?$/i.test(file.name) ? "text/html" : "text/plain");
          resolve({ name: file.name, mimeType: type, base64: base64Of(await file.arrayBuffer()) });
        };
        input.click();
      });
    },
    async download(file: DownloadRequest) {
      if (client.embedded) throw new Error("Download it from Job Search in your browser. This view can't save files.");
      const name = file.name.split(/[\\/]/).pop()?.trim() || "export";
      const blob = file.text !== undefined ? new Blob([file.text], { type: file.mimeType }) : new Blob([Uint8Array.from(atob(file.base64 ?? ""), (char) => char.charCodeAt(0))], { type: file.mimeType });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    },
    changed(summary: string) {
      client.didChange(summary);
      window.dispatchEvent(new Event("app-data-changed"));
    },
  }), [client, navigate, location.pathname]);

  const follow = useMemo(() => ({ follow(listener: (value: unknown) => void) { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; } }), []);
  const value = useMemo<RiApp>(() => ({ data, revision, theme, connected: state !== undefined, error, moves, embedded: client.embedded, ...actions }), [data, revision, theme, state, error, moves, client.embedded, actions]);
  useEffect(() => () => client.select(null), [client]);

  return (
    <RiAppContext.Provider value={value}>
      <MovesContext.Provider value={follow}>
        <LiveRegion>{children}</LiveRegion>
        {asking !== null && (
          <Dialog open title="Ask your assistant" onClose={() => setAsking(null)} footer={<Button variant="primary" onClick={() => { void navigator.clipboard?.writeText(asking).catch(() => {}); setAsking(null); }}>Copy and close</Button>}>
            <p className="ri-small ri-muted">Copy this into your chat with Ri (or another assistant that has Job Search). Edit it before you send it. Nothing is sent from here.</p>
            <textarea className="ri-input" readOnly rows={6} value={asking} onFocus={(event) => event.currentTarget.select()} style={{ width: "100%" }} />
          </Dialog>
        )}
        {notice !== null && (
          <Dialog open title="In your browser" onClose={() => setNotice(null)} footer={<Button onClick={() => setNotice(null)}>Close</Button>}>
            <p style={{ overflowWrap: "anywhere" }}>{notice}</p>
          </Dialog>
        )}
      </MovesContext.Provider>
    </RiAppContext.Provider>
  );
}
