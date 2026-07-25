import assert from "node:assert/strict";
import { processDetected, type LocalIntegrationDiscovery } from "./integration-discovery.js";

const discovery: LocalIntegrationDiscovery = {
  processes: ["blender.exe", "cloudflared.exe", "serena.exe"],
  executables: { cloudflared: "C:/tools/cloudflared.exe", serena: "C:/tools/serena.exe" },
  ports: {
    blender_lab_mcp: true,
    auvrynt_blender_bridge: false,
    auvrynt_godot_bridge: false,
  },
};

assert.equal(processDetected(discovery, "blender"), true);
assert.equal(processDetected(discovery, "cloudflare_tunnel"), true);
assert.equal(processDetected(discovery, "serena"), true);
assert.equal(processDetected(discovery, "godot"), false);

console.log("Integration discovery unit tests passed!");
