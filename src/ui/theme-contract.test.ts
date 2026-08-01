import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, dashboardSource, dashboardStylesSource, oauthSource, resultCss, toolMetaSource, serverFactorySource] = await Promise.all([
  readFile(new URL("./brand-theme.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/dashboard-page.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/dashboard-page-styles.ts", import.meta.url), "utf8"),
  readFile(new URL("../auth/oauth-provider.ts", import.meta.url), "utf8"),
  readFile(new URL("./workspace-app.css", import.meta.url), "utf8"),
  readFile(new URL("../server/tool-registration-shared.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/mcp-server-factory.ts", import.meta.url), "utf8"),
]);
const dashboardContractSource = `${dashboardSource}\n${dashboardStylesSource}`;

for (const color of [
  "#11051f",
  "#1e0b36",
  "#0b0714",
  "#fbf7ff",
  "#c4b5fd",
  "#c084fc",
  "#e9d5ff",
  "#f0abfc",
]) {
  assert.ok(themeSource.toLowerCase().includes(color), `shared theme is missing ${color}`);
}

assert.match(dashboardContractSource, /AUVRYNT_THEME_CSS/);
assert.match(oauthSource, /AUVRYNT_THEME_CSS/);
assert.match(dashboardContractSource, /grid-template-columns:\s*250px minmax\(0,\s*1fr\)/);
assert.match(dashboardSource, /data-log-filter="tool"/);
assert.match(dashboardSource, /firstVisibleAnchor/);
assert.match(dashboardSource, /logs\.scrollTop = 0/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/integrations/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/restart/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/stop/);
assert.match(dashboardContractSource, /@keyframes status-heartbeat/);
assert.match(dashboardSource, /role="tab"/);
assert.match(dashboardSource, /data-view-panel="analytics"/);
assert.match(dashboardSource, /data-view-panel="connectivity"/);
assert.match(dashboardSource, /class="runtime-strip"/);
assert.match(dashboardSource, /class="change-surface"/);
assert.match(dashboardSource, /id="files-created"/);
assert.match(dashboardSource, /id="files-deleted"/);
assert.match(dashboardSource, /id="change-additions"/);
assert.match(dashboardSource, /id="change-removals"/);
assert.match(dashboardSource, /data-copy-url="local"/);
assert.doesNotMatch(dashboardSource, /id="workspace-editor"/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/select-workspace/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/workspace/);
assert.doesNotMatch(dashboardSource, /id="command-form"/);
assert.doesNotMatch(dashboardSource, /id="command-output"/);
assert.doesNotMatch(dashboardSource, /__auvrynt\/dashboard\/command/);
assert.match(dashboardSource, /id="confirm-dialog"/);
assert.doesNotMatch(dashboardSource, /window\.confirm/);
assert.match(dashboardContractSource, /\.server-state\s*\{[^}]*border:\s*0/);
assert.match(dashboardSource, /id="session-limit-form"/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/session-limit/);
assert.match(dashboardSource, /id="session-idle-timeout-form"/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/session-idle-timeout/);
assert.doesNotMatch(dashboardSource, /id="pause-logs"/);
assert.doesNotMatch(dashboardSource, /id="clear-logs"/);
assert.match(dashboardSource, /class="log-filter-row"/);
assert.doesNotMatch(dashboardSource, /The indicator changes only after an authenticated MCP session connects/);
assert.match(dashboardSource, /class="activity-chart"/);
assert.match(dashboardSource, /function renderAnalytics\(\)/);
assert.match(dashboardSource, /data-state="\$\{view\.agentState\}"/);
assert.match(dashboardSource, /function beginLifecycle\(mode, message, detail\)/);
assert.match(dashboardSource, /function waitForRestart\(\)/);
assert.match(dashboardSource, /function waitForStop\(\)/);
assert.doesNotMatch(dashboardSource, /\.state\.connected\s*\{\s*color:\s*var\(--auvrynt-success\)/);

assert.match(toolMetaSource, /workspace-app-v3\.html/);
assert.match(toolMetaSource, /visibility:\s*\["model",\s*"app"\]/);
assert.match(toolMetaSource, /"openai\/outputTemplate"/);
assert.match(toolMetaSource, /"openai\/toolInvocation\/invoking"/);
assert.match(serverFactorySource, /"openai\/widgetDescription"/);
assert.match(serverFactorySource, /"openai\/widgetPrefersBorder": false/);
assert.match(serverFactorySource, /prefersBorder: false/);

assert.match(resultCss, /--result-bg:\s*#11051f/);
assert.match(resultCss, /linear-gradient/);
assert.match(resultCss, /--result-accent:\s*#c084fc/);
assert.match(resultCss, /@keyframes result-heartbeat/);
assert.doesNotMatch(resultCss, /#f28b82|#ffb4b4/i);

console.log("Dashboard, authorization, and result-card theme contracts passed!");
