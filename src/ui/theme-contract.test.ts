import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, dashboardSource, oauthSource, resultCss] = await Promise.all([
  readFile(new URL("./brand-theme.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/dashboard.ts", import.meta.url), "utf8"),
  readFile(new URL("../auth/oauth-provider.ts", import.meta.url), "utf8"),
  readFile(new URL("./workspace-app.css", import.meta.url), "utf8"),
]);

for (const color of [
  "#11051f",
  "#1e0b36",
  "#0b0714",
  "#fbf7ff",
  "#c4b5fd",
  "#c084fc",
  "#e9d5ff",
]) {
  assert.ok(themeSource.toLowerCase().includes(color), `shared theme is missing ${color}`);
}

assert.match(dashboardSource, /AUVRYNT_THEME_CSS/);
assert.match(oauthSource, /AUVRYNT_THEME_CSS/);
assert.match(dashboardSource, /grid-template-columns:\s*minmax\(0,\s*\.9fr\)/);
assert.match(dashboardSource, /data-log-filter="tool"/);
assert.match(dashboardSource, /firstVisibleAnchor/);
assert.match(dashboardSource, /logs\.scrollTop = 0/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/integrations/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/restart/);
assert.match(dashboardSource, /__auvrynt\/dashboard\/stop/);

assert.match(resultCss, /--result-bg:\s*#181818/);
assert.doesNotMatch(resultCss, /radial-gradient|linear-gradient/);
assert.doesNotMatch(resultCss, /#c084fc|#1e0b36|#11051f/i);

console.log("Dashboard, authorization, and result-card theme contracts passed!");
