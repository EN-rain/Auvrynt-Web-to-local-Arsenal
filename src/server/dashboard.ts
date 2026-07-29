import type { ServerConfig } from "../config.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";
import { AUVRYNT_COMMANDS } from "../infrastructure/command-reference.js";
import type { RecentLogEntry } from "../infrastructure/logger.js";
import { recentLogEntries } from "../infrastructure/logger.js";
import { getPlaywrightRuntimeStatus } from "../playwright-runtime.js";
import { AUVRYNT_THEME_CSS } from "../ui/brand-theme.js";

export type DashboardIntegrationKey = keyof ServerConfig["integrations"];

export interface DashboardIntegration {
  key: DashboardIntegrationKey;
  label: string;
  enabled: boolean;
  state: "connected" | "available" | "offline" | "disabled";
  detail: string;
}

export interface DashboardView {
  ready: boolean;
  pid: number;
  uptimeSeconds: number;
  localMcpUrl: string;
  publicMcpUrl: string;
  allowedRoots: string[];
  sessions: number;
  runningProcesses: number;
  integrations: DashboardIntegration[];
  logs: RecentLogEntry[];
}

export interface DashboardRuntimeSnapshot {
  ready: boolean;
  sessions: number;
  runningProcesses: number;
}

const INTEGRATION_LABELS: Record<DashboardIntegrationKey, string> = {
  godotGdscript: "Godot GDScript",
  godotCsharp: "Godot C#",
  blender: "Blender",
  serena: "Serena",
  playwright: "Playwright",
};

export async function createDashboardView(
  config: ServerConfig,
  runtime: DashboardRuntimeSnapshot,
): Promise<DashboardView> {
  const discovered = await discoverLocalIntegrations().catch(() => undefined);
  const playwright = getPlaywrightRuntimeStatus();
  const integration = (
    key: DashboardIntegrationKey,
    connected: boolean,
    available: boolean,
    connectedDetail: string,
    availableDetail: string,
    offlineDetail: string,
  ): DashboardIntegration => {
    const enabled = config.integrations[key];
    if (!enabled) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "disabled", detail: "Not included in the active profile." };
    }
    if (connected) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "connected", detail: connectedDetail };
    }
    if (available) {
      return { key, label: INTEGRATION_LABELS[key], enabled, state: "available", detail: availableDetail };
    }
    return { key, label: INTEGRATION_LABELS[key], enabled, state: "offline", detail: offlineDetail };
  };

  const godotConnected = Boolean(discovered?.ports.auvrynt_godot_bridge);
  const godotAvailable = Boolean(discovered && (processDetected(discovered, "godot") || discovered.executables.godot || discovered.executables.godotCsharp));
  const blenderConnected = Boolean(discovered?.ports.auvrynt_blender_bridge || discovered?.ports.blender_lab_mcp);
  const blenderAvailable = Boolean(discovered && (processDetected(discovered, "blender") || discovered.executables.blender));
  const serenaConnected = Boolean(discovered && processDetected(discovered, "serena"));
  const serenaAvailable = Boolean(discovered?.executables.serena || config.serena.executable);

  return {
    ready: runtime.ready,
    pid: process.pid,
    uptimeSeconds: process.uptime(),
    localMcpUrl: localHttpUrl(config.host, config.port, "/mcp"),
    publicMcpUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`,
    allowedRoots: [...config.allowedRoots],
    sessions: runtime.sessions,
    runningProcesses: runtime.runningProcesses,
    integrations: [
      integration("godotCsharp", godotConnected, godotAvailable, "Godot bridge is connected.", "Godot is available; waiting for the bridge.", "Godot or its bridge is not detected."),
      integration("godotGdscript", godotConnected, godotAvailable, "Godot bridge is connected.", "Godot is available; waiting for the bridge.", "Godot or its bridge is not detected."),
      integration("blender", blenderConnected, blenderAvailable, "Blender MCP bridge is connected.", "Blender is available; waiting for its bridge.", "Blender is not detected."),
      integration("serena", serenaConnected, serenaAvailable, "Serena is running.", "Serena is installed and starts on demand.", "Serena is not detected."),
      integration("playwright", false, playwright.chromiumInstalled, "Playwright browser is active.", "Chromium is installed and starts on demand.", "Playwright Chromium is unavailable."),
    ],
    logs: recentLogEntries(250).reverse(),
  };
}

export function dashboardHtml(view: DashboardView, nonce: string): string {
  const commandGroups = groupCommands();
  const enabled = view.integrations.filter((item) => item.enabled).map((item) => item.label).join(" · ") || "No optional integrations";
  const commandColumns: Array<Array<[string, typeof AUVRYNT_COMMANDS[number][]]>> = [[], []];
  const commandColumnWeights = [0, 0];
  for (const entry of commandGroups.entries()) {
    const columnIndex = commandColumnWeights[0] <= commandColumnWeights[1] ? 0 : 1;
    commandColumns[columnIndex].push(entry);
    commandColumnWeights[columnIndex] += entry[1].length + 1;
  }
  const commands = commandColumns.map((column) => `
        <div class="command-column">
          ${column.map(([group, items]) => `<section class="command-group" data-command-group>
            <h3>${escapeHtml(group)}</h3>
            ${items.map((item) => `<div class="command-row" data-command-search="${escapeHtml(`${item.command} ${item.description}`.toLowerCase())}"><code>${escapeHtml(item.command)}</code><span>${escapeHtml(item.description)}</span></div>`).join("\n")}
          </section>`).join("\n")}
        </div>`).join("\n");
  const initialData = jsonForHtml(view);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Auvrynt Dashboard</title>
    <style nonce="${escapeHtml(nonce)}">
      ${AUVRYNT_THEME_CSS}
      *, *::before, *::after { box-sizing: border-box; }
      html { min-height: 100%; background: var(--auvrynt-bg-deep); }
      body { margin: 0; min-height: 100vh; overflow-x: hidden; color: var(--auvrynt-text); background: radial-gradient(circle at 20% 0%, rgba(168,85,247,.20), transparent 36%), linear-gradient(135deg, var(--auvrynt-bg), var(--auvrynt-surface) 52%, var(--auvrynt-bg-deep)); font-family: var(--auvrynt-font-sans); }
      button, input { font: inherit; }
      button:focus-visible, input:focus-visible { outline: 2px solid var(--auvrynt-accent); outline-offset: 2px; }
      .shell { width: min(1240px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
      .dashboard { overflow: hidden; border: 1px solid var(--auvrynt-border); border-radius: 12px; background: rgba(12,6,24,.70); box-shadow: 0 22px 80px rgba(5,2,12,.32); backdrop-filter: blur(18px); }
      .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 24px 26px; border-bottom: 1px solid var(--auvrynt-border-soft); }
      .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .brand img { width: 46px; height: 46px; border-radius: 10px; }
      .eyebrow { margin: 0 0 3px; color: var(--auvrynt-accent); font-size: 10px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 28px; line-height: 1; letter-spacing: -.04em; }
      .summary { margin: 7px 0 0; color: var(--auvrynt-text-secondary); font-size: 13px; }
      .header-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
      .top-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .button { min-height: 36px; padding: 8px 12px; border: 1px solid var(--auvrynt-border); border-radius: 7px; color: var(--auvrynt-accent-soft); background: transparent; cursor: pointer; font-size: 12px; font-weight: 750; }
      .button:hover { background: rgba(192,132,252,.10); }
      .button.primary { border-color: var(--auvrynt-accent); color: var(--auvrynt-surface); background: linear-gradient(135deg, var(--auvrynt-accent-soft), var(--auvrynt-accent)); }
      .button.danger:hover { border-color: var(--auvrynt-danger); color: var(--auvrynt-danger); background: rgba(255,180,180,.08); }
      .status-line { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; color: var(--auvrynt-accent-soft); font-size: 12px; }
      .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--auvrynt-accent); box-shadow: 0 0 0 3px rgba(192,132,252,.12); animation: status-pulse 2.4s ease-in-out infinite; }
      .status-dot.stopping { background: var(--auvrynt-warning); animation: none; box-shadow: 0 0 0 3px rgba(253,224,71,.10); }
      @keyframes status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .58; } }
      .overview { display: grid; grid-template-columns: minmax(0, .9fr) minmax(360px, 1.1fr); border-bottom: 1px solid var(--auvrynt-border-soft); }
      .panel { min-width: 0; padding: 22px 26px 24px; }
      .panel + .panel { border-left: 1px solid var(--auvrynt-border-soft); }
      h2 { margin: 0 0 16px; color: var(--auvrynt-accent); font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      h3 { margin: 0 0 8px; color: var(--auvrynt-accent-soft); font-size: 12px; }
      .kv { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 9px 14px; margin: 0; }
      .kv dt { color: var(--auvrynt-text-muted); font-size: 12px; }
      .kv dd { min-width: 0; margin: 0; color: var(--auvrynt-text-secondary); font: 12px/1.5 var(--auvrynt-font-mono); overflow-wrap: anywhere; }
      a { color: var(--auvrynt-accent-soft); text-underline-offset: 3px; }
      .integration-row { display: grid; grid-template-columns: minmax(130px, 1fr) 92px minmax(110px, auto); align-items: center; gap: 12px; min-height: 44px; border-top: 1px solid var(--auvrynt-border-soft); }
      .integration-row:first-child { border-top: 0; }
      .integration-name { min-width: 0; }
      .integration-name strong { display: block; font-size: 13px; }
      .integration-name small { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font-size: 10px; line-height: 1.3; }
      .state { color: var(--auvrynt-text-muted); font: 11px var(--auvrynt-font-mono); text-transform: uppercase; }
      .state.connected { color: var(--auvrynt-success); }
      .state.available { color: var(--auvrynt-accent-soft); }
      .state.offline { color: var(--auvrynt-warning); }
      .integration-row .button { justify-self: end; min-width: 84px; }
      .section { padding: 22px 26px 26px; border-bottom: 1px solid var(--auvrynt-border-soft); }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
      .section-head h2 { margin: 0; }
      .search { width: min(320px, 100%); min-height: 36px; padding: 8px 11px; border: 1px solid var(--auvrynt-border); border-radius: 7px; color: var(--auvrynt-text); background: var(--auvrynt-code); }
      .search::placeholder { color: #657388; }
      .commands { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(260px, .85fr); align-items: start; column-gap: 24px; max-height: min(52vh, 460px); overflow-x: hidden; overflow-y: auto; padding-right: 8px; scrollbar-width: thin; scrollbar-color: rgba(192,132,252,.55) transparent; }
      .commands::-webkit-scrollbar, .logs::-webkit-scrollbar { width: 8px; height: 8px; }
      .commands::-webkit-scrollbar-track, .logs::-webkit-scrollbar-track { background: transparent; }
      .commands::-webkit-scrollbar-thumb, .logs::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(192,132,252,.45); background-clip: padding-box; }
      .commands::-webkit-scrollbar-thumb:hover, .logs::-webkit-scrollbar-thumb:hover { background: rgba(216,180,254,.78); background-clip: padding-box; }
      .command-column { display: flex; min-width: 0; flex-direction: column; gap: 14px; }
      .command-group { min-width: 0; }
      .command-group h3 { margin-bottom: 5px; }
      .command-row { display: grid; grid-template-columns: minmax(190px, .85fr) minmax(0, 1.15fr); gap: 12px; padding: 6px 0; border-top: 1px solid rgba(216,180,254,.10); }
      .command-row code { color: var(--auvrynt-accent-soft); font: 11px/1.45 var(--auvrynt-font-mono); overflow-wrap: anywhere; }
      .command-row span { color: var(--auvrynt-text-muted); font-size: 11px; line-height: 1.45; }
      .log-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
      .filter { min-height: 30px; padding: 5px 9px; border: 1px solid transparent; border-radius: 6px; color: var(--auvrynt-text-muted); background: transparent; cursor: pointer; font-size: 10px; font-weight: 750; text-transform: uppercase; }
      .filter.active { border-color: var(--auvrynt-border); color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.09); }
      .logs-wrap { position: relative; }
      .logs { height: min(46vh, 520px); min-height: 300px; overflow: auto; border-top: 1px solid var(--auvrynt-border-soft); border-bottom: 1px solid var(--auvrynt-border-soft); background: var(--auvrynt-code); font-family: var(--auvrynt-font-mono); scrollbar-width: thin; scrollbar-color: rgba(192,132,252,.55) transparent; }
      .log-row { display: grid; grid-template-columns: 82px 54px minmax(150px, 220px) minmax(0, 1fr); gap: 10px; padding: 8px 12px; border-bottom: 1px solid rgba(216,180,254,.08); color: var(--auvrynt-text-secondary); font-size: 11px; line-height: 1.45; }
      .log-row time, .log-level { color: var(--auvrynt-text-muted); }
      .log-level.warn { color: var(--auvrynt-warning); }
      .log-level.error { color: var(--auvrynt-danger); }
      .log-event { color: var(--auvrynt-accent-soft); overflow-wrap: anywhere; }
      .log-fields { min-width: 0; color: var(--auvrynt-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
      .new-logs { position: absolute; z-index: 2; top: 10px; right: 12px; display: none; }
      .new-logs.visible { display: block; }
      .empty { padding: 28px 12px; color: var(--auvrynt-text-muted); text-align: center; }
      .notice { min-height: 18px; margin: 10px 0 0; color: var(--auvrynt-text-secondary); font-size: 11px; }
      footer { padding: 15px 26px 18px; color: var(--auvrynt-text-muted); font-size: 10px; }
      [hidden] { display: none !important; }
      @media (max-width: 900px) { .overview { grid-template-columns: 1fr; } .panel + .panel { border-left: 0; border-top: 1px solid var(--auvrynt-border-soft); } .commands { grid-template-columns: 1fr; } }
      @media (max-width: 680px) { .shell { width: min(100% - 16px, 1240px); padding: 8px 0 24px; } .dashboard { border-radius: 9px; } .topbar { display: block; padding: 18px; } .header-actions { justify-content: flex-start; margin-top: 16px; } .top-actions { justify-content: flex-start; } .panel, .section { padding: 18px; } .section-head { align-items: stretch; flex-direction: column; } .search { width: 100%; } .integration-row { grid-template-columns: 1fr auto; padding: 8px 0; } .integration-row .state { grid-column: 1; } .integration-row .button { grid-column: 2; grid-row: 1 / span 2; } .command-row { grid-template-columns: 1fr; gap: 3px; } .log-row { grid-template-columns: 70px 48px minmax(0, 1fr); } .log-fields { grid-column: 1 / -1; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <main class="dashboard">
        <header class="topbar">
          <div>
            <div class="brand">
              <img src="/brand-assets/auvrynt-icon.png" alt="" width="46" height="46" />
              <div><p class="eyebrow">Local control center</p><h1>Auvrynt</h1></div>
            </div>
            <p class="summary" id="summary">${escapeHtml(enabled)} · PID ${view.pid} · Uptime ${escapeHtml(formatUptime(view.uptimeSeconds))}</p>
          </div>
          <div class="header-actions">
            <div class="status-line"><span class="status-dot${view.ready ? "" : " stopping"}" id="status-dot"></span><strong id="status-text">${view.ready ? "Connected" : "Stopping"}</strong></div>
            <div class="top-actions">
              <button class="button" id="copy-url" type="button">Copy MCP URL</button>
              <button class="button primary" id="restart" type="button">Restart</button>
              <button class="button danger" id="stop" type="button">Stop</button>
            </div>
          </div>
        </header>

        <div class="overview">
          <section class="panel">
            <h2>Connection</h2>
            <dl class="kv">
              <dt>Local MCP</dt><dd><a id="local-mcp" href="${escapeHtml(view.localMcpUrl)}">${escapeHtml(view.localMcpUrl)}</a></dd>
              <dt>Public MCP</dt><dd><a id="public-mcp" href="${escapeHtml(view.publicMcpUrl)}">${escapeHtml(view.publicMcpUrl)}</a></dd>
              <dt>Workspace</dt><dd id="workspace">${escapeHtml(view.allowedRoots.join(", "))}</dd>
              <dt>Sessions</dt><dd id="sessions">${view.sessions}</dd>
              <dt>Processes</dt><dd id="processes">${view.runningProcesses}</dd>
            </dl>
          </section>
          <section class="panel">
            <h2>Integrations</h2>
            <div id="integrations"></div>
            <p class="notice" id="action-notice" role="status" aria-live="polite"></p>
          </section>
        </div>

        <section class="section">
          <div class="section-head"><h2>Commands</h2><input class="search" id="command-search" type="search" placeholder="Filter commands…" autocomplete="off" /></div>
          <div class="commands" id="commands">${commands}</div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Recent logs</h2>
            <div class="log-controls">
              <input class="search" id="log-search" type="search" placeholder="Search logs…" autocomplete="off" />
              <button class="filter active" data-log-filter="all" type="button">All</button>
              <button class="filter" data-log-filter="tool" type="button">Tool</button>
              <button class="filter" data-log-filter="mcp" type="button">MCP</button>
              <button class="filter" data-log-filter="http" type="button">HTTP</button>
              <button class="filter" data-log-filter="auth" type="button">Auth</button>
              <button class="filter" data-log-filter="tunnel" type="button">Tunnel</button>
              <button class="filter" data-log-filter="error" type="button">Error</button>
              <button class="button" id="pause-logs" type="button">Pause</button>
              <button class="button" id="clear-logs" type="button">Clear view</button>
            </div>
          </div>
          <div class="logs-wrap">
            <button class="button new-logs" id="new-logs" type="button"></button>
            <div class="logs" id="logs" tabindex="0" aria-label="Recent Auvrynt logs"></div>
          </div>
        </section>
        <footer>Local-only dashboard. Authentication secrets and network addresses are excluded from displayed logs.</footer>
      </main>
    </div>
    <script nonce="${escapeHtml(nonce)}">
      (() => {
        let state = ${initialData};
        let paused = false;
        let queuedState = null;
        let activeFilter = "all";
        let hiddenThroughId = 0;
        let knownNewestId = state.logs[0]?.id ?? 0;
        let unseenLogs = 0;
        const logs = document.getElementById("logs");
        const integrations = document.getElementById("integrations");
        const notice = document.getElementById("action-notice");
        const newLogs = document.getElementById("new-logs");
        const logSearch = document.getElementById("log-search");

        const category = (entry) => {
          const event = entry.event.toLowerCase();
          if (entry.level === "error") return "error";
          if (event.includes("tool")) return "tool";
          if (event.includes("mcp") || event.includes("session")) return "mcp";
          if (event.includes("auth") || event.includes("oauth") || event.includes("token")) return "auth";
          if (event.includes("tunnel") || event.includes("cloudflare") || event.includes("ngrok")) return "tunnel";
          if (event.includes("http")) return "http";
          return "other";
        };
        const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
        const time = (value) => new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const uptime = (seconds) => {
          const total = Math.max(0, Math.floor(seconds));
          const days = Math.floor(total / 86400);
          const hours = Math.floor((total % 86400) / 3600);
          const minutes = Math.floor((total % 3600) / 60);
          return [days ? days + "d" : "", hours ? hours + "h" : "", minutes + "m"].filter(Boolean).join(" ");
        };
        const enabledSummary = (items) => items.filter((item) => item.enabled).map((item) => item.label).join(" · ") || "No optional integrations";

        function firstVisibleAnchor() {
          const rows = [...logs.querySelectorAll(".log-row")];
          const row = rows.find((item) => item.offsetTop + item.offsetHeight >= logs.scrollTop);
          return row ? { id: row.dataset.logId, offset: row.offsetTop - logs.scrollTop } : null;
        }
        function updateNewLogButton() {
          newLogs.textContent = unseenLogs === 1 ? "↑ 1 new log" : "↑ " + unseenLogs + " new logs";
          newLogs.classList.toggle("visible", unseenLogs > 0 && logs.scrollTop > 4);
        }
        function renderLogs() {
          const atTop = logs.scrollTop <= 4;
          const anchor = atTop ? null : firstVisibleAnchor();
          const query = logSearch.value.trim().toLowerCase();
          const visible = state.logs.filter((entry) => {
            if (entry.id <= hiddenThroughId) return false;
            const entryCategory = category(entry);
            if (activeFilter === "error" && entry.level !== "error") return false;
            if (activeFilter !== "all" && activeFilter !== "error" && entryCategory !== activeFilter) return false;
            return !query || (entry.ts + " " + entry.level + " " + entry.event + " " + JSON.stringify(entry.fields)).toLowerCase().includes(query);
          });
          logs.innerHTML = visible.length ? visible.map((entry) => '<div class="log-row" data-log-id="' + entry.id + '" data-category="' + category(entry) + '"><time>' + time(entry.ts) + '</time><span class="log-level ' + entry.level + '">' + escape(entry.level.toUpperCase()) + '</span><span class="log-event">' + escape(entry.event) + '</span><span class="log-fields">' + escape(Object.keys(entry.fields).length ? JSON.stringify(entry.fields) : "") + '</span></div>').join("") : '<div class="empty">No matching events.</div>'; 
          if (atTop) {
            logs.scrollTop = 0;
            unseenLogs = 0;
          } else if (anchor) {
            const anchored = logs.querySelector('[data-log-id="' + anchor.id + '"]');
            if (anchored) logs.scrollTop = anchored.offsetTop - anchor.offset;
          }
          updateNewLogButton();
        }
        function renderIntegrations() {
          integrations.innerHTML = state.integrations.map((item) => '<div class="integration-row"><div class="integration-name"><strong>' + escape(item.label) + '</strong><small>' + escape(item.detail) + '</small></div><span class="state ' + item.state + '">' + escape(item.state) + '</span><button class="button" type="button" data-integration="' + escape(item.key) + '" data-enabled="' + item.enabled + '">' + (item.enabled ? "Disable" : "Enable") + '</button></div>').join("");
        }
        function renderState(nextState) {
          const previousNewestId = knownNewestId;
          state = nextState;
          knownNewestId = state.logs[0]?.id ?? previousNewestId;
          if (knownNewestId > previousNewestId && logs.scrollTop > 4) {
            unseenLogs += state.logs.filter((entry) => entry.id > previousNewestId).length;
          }
          document.getElementById("summary").textContent = enabledSummary(state.integrations) + " · PID " + state.pid + " · Uptime " + uptime(state.uptimeSeconds);
          document.getElementById("status-text").textContent = state.ready ? "Connected" : "Stopping";
          document.getElementById("status-dot").classList.toggle("stopping", !state.ready);
          document.getElementById("sessions").textContent = String(state.sessions);
          document.getElementById("processes").textContent = String(state.runningProcesses);
          document.getElementById("workspace").textContent = state.allowedRoots.join(", ");
          document.getElementById("local-mcp").textContent = state.localMcpUrl;
          document.getElementById("public-mcp").textContent = state.publicMcpUrl;
          renderIntegrations();
          renderLogs();
        }
        async function refresh() {
          try {
            const response = await fetch("/dashboard/data", { cache: "no-store" });
            if (!response.ok) throw new Error("Dashboard refresh failed (" + response.status + ")");
            const nextState = await response.json();
            if (paused) queuedState = nextState;
            else renderState(nextState);
          } catch (error) {
            notice.textContent = error instanceof Error ? error.message : String(error);
          }
        }
        async function action(path, body, confirmation) {
          if (confirmation && !window.confirm(confirmation)) return;
          notice.textContent = "Applying…";
          try {
            const response = await fetch(path, {
              method: "POST",
              headers: { "content-type": "application/json", "x-auvrynt-dashboard": "1" },
              body: JSON.stringify(body ?? {}),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Action failed (" + response.status + ")");
            notice.textContent = result.message || "Action accepted.";
            if (!paused && path.includes("integrations")) await refresh();
          } catch (error) {
            notice.textContent = error instanceof Error ? error.message : String(error);
          }
        }

        integrations.addEventListener("click", (event) => {
          const button = event.target.closest("[data-integration]");
          if (!button) return;
          const enabled = button.dataset.enabled === "true";
          const label = button.closest(".integration-row")?.querySelector("strong")?.textContent || "integration";
          action("/__auvrynt/dashboard/integrations", { integration: button.dataset.integration, enabled: !enabled }, enabled ? "Disable " + label + "? Active operations for it may be interrupted." : undefined);
        });
        document.getElementById("restart").addEventListener("click", () => action("/__auvrynt/dashboard/restart", {}, "Restart Auvrynt? Connected agents may briefly lose access."));
        document.getElementById("stop").addEventListener("click", () => action("/__auvrynt/dashboard/stop", {}, "Stop Auvrynt? Connected agents will lose access."));
        document.getElementById("copy-url").addEventListener("click", async () => {
          await navigator.clipboard.writeText(state.publicMcpUrl);
          notice.textContent = "Public MCP URL copied.";
        });
        document.getElementById("command-search").addEventListener("input", (event) => {
          const query = event.target.value.trim().toLowerCase();
          document.querySelectorAll("[data-command-search]").forEach((row) => { row.hidden = query && !row.dataset.commandSearch.includes(query); });
          document.querySelectorAll("[data-command-group]").forEach((group) => { group.hidden = !group.querySelector("[data-command-search]:not([hidden])"); });
        });
        document.querySelectorAll("[data-log-filter]").forEach((button) => button.addEventListener("click", () => {
          activeFilter = button.dataset.logFilter;
          document.querySelectorAll("[data-log-filter]").forEach((item) => item.classList.toggle("active", item === button));
          renderLogs();
        }));
        logSearch.addEventListener("input", renderLogs);
        logs.addEventListener("scroll", () => { if (logs.scrollTop <= 4) unseenLogs = 0; updateNewLogButton(); });
        newLogs.addEventListener("click", () => { logs.scrollTop = 0; unseenLogs = 0; updateNewLogButton(); });
        document.getElementById("pause-logs").addEventListener("click", (event) => {
          paused = !paused;
          event.target.textContent = paused ? "Resume" : "Pause";
          if (!paused && queuedState) { const next = queuedState; queuedState = null; renderState(next); }
        });
        document.getElementById("clear-logs").addEventListener("click", () => {
          hiddenThroughId = state.logs[0]?.id ?? hiddenThroughId;
          unseenLogs = 0;
          renderLogs();
        });

        renderState(state);
        window.setInterval(refresh, 2000);
      })();
    </script>
  </body>
</html>`;
}

export function dashboardCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function groupCommands(): Map<string, typeof AUVRYNT_COMMANDS[number][]> {
  const groups = new Map<string, typeof AUVRYNT_COMMANDS[number][]>();
  for (const item of AUVRYNT_COMMANDS) {
    const command = item.command.toLowerCase();
    const group = command.includes("token") || command.includes("connected")
      ? "Authentication"
      : command.includes("config") || command.includes("init") || command.includes("setup")
        ? "Configuration"
        : command.includes("doctor") || command.includes("status")
          ? "Diagnostics"
          : command.includes("enable") || command.includes("disable") || command.includes(" add ")
            ? "Integrations"
            : command.includes("uninstall")
              ? "Cleanup"
              : "Server lifecycle";
    const items = groups.get(group) ?? [];
    items.push(item);
    groups.set(group, items);
  }
  return groups;
}

function localHttpUrl(host: string, port: number, path: string): string {
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = probeHost.includes(":") && !probeHost.startsWith("[") ? `[${probeHost}]` : probeHost;
  return `http://${formattedHost}:${port}${path}`;
}

function formatUptime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
