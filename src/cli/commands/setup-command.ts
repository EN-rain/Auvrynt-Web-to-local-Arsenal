import * as prompts from "@clack/prompts";
import { ensureGlobalGodotPlugin } from "../../godot-tools.js";
import { ensureGlobalAsepriteBridge } from "../../integrations/aseprite/aseprite-live-tools.js";
import { loadAuvryntFiles, writeAuvryntConfig } from "../../user-config.js";

const SETUP_TOOL_LABELS: Record<string, string> = {
  godot: "Godot        - GDScript game engine",
  godotCsharp: "Godot C#     - .NET / Mono Godot build",
  asepriteSource: "Aseprite     - source/build directory",
};
const SETUP_TOOL_KEYS = ["godot", "godotCsharp", "asepriteSource"] as const;
type SetupToolKey = (typeof SETUP_TOOL_KEYS)[number];

export async function runSetupCommand(args: string[] = []): Promise<void> {
  const files = loadAuvryntFiles();
  const existingExecs: Record<string, string | undefined> = files.config.executables ?? {};

  if (args.length >= 2) {
    const toolKeyMap: Record<string, SetupToolKey> = {
      godot: "godot",
      godotcsharp: "godotCsharp",
      "godot-csharp": "godotCsharp",
      aseprite: "asepriteSource",
      "aseprite-source": "asepriteSource",
    };
    const key = toolKeyMap[args[0].toLowerCase()];
    if (key) {
      const exePath = args.slice(1).join(" ").trim().replace(/^["']|["']$/g, "").trim();
      writeAuvryntConfig({ ...files.config, executables: { ...existingExecs, [key]: exePath } });
      if (key === "asepriteSource") {
        const bridge = await ensureGlobalAsepriteBridge();
        console.log(`Installed Aseprite live bridge: ${bridge.targetPath}`);
      }
      console.log(`Updated ${key} executable path: ${exePath}`);
      return;
    }
  }

  prompts.intro("  Auvrynt Setup - configure local tool integrations  ");
  const picked = await prompts.select({
    message: "Select integration to configure  (Enter to confirm)",
    options: SETUP_TOOL_KEYS.map((key) => ({
      value: key,
      label: SETUP_TOOL_LABELS[key],
      hint: existingExecs[key] ? `currently: ${existingExecs[key]}` : "not set",
    })),
  });
  if (prompts.isCancel(picked)) {
    prompts.cancel("Setup cancelled.");
    return;
  }

  const key = picked as SetupToolKey;
  const labelName = SETUP_TOOL_LABELS[key].split(" - ")[0].trim();
  const placeholder = key === "godot"
    ? "e.g. C:\\Program Files\\Godot\\Godot.exe"
    : key === "godotCsharp"
      ? "e.g. C:\\Program Files\\Godot_v4-mono\\Godot.exe  (.NET build)"
      : "e.g. C:\\Users\\you\\src\\aseprite  (contains build\\bin\\aseprite.exe)";
  const answer = await prompts.text({
    message: `${labelName} executable path`,
    placeholder,
    initialValue: existingExecs[key] ?? "",
    validate: (value) => (value ?? "").trim() ? undefined : "Path cannot be empty.",
  });
  if (prompts.isCancel(answer)) {
    prompts.cancel("Setup cancelled.");
    return;
  }

  const executablePath = String(answer).trim().replace(/^["']|["']$/g, "").trim();
  writeAuvryntConfig({
    ...files.config,
    executables: { ...files.config.executables, [key]: executablePath },
  });

  if (key === "godot" || key === "godotCsharp") {
    const pluginResult = ensureGlobalGodotPlugin();
    if (pluginResult.installed) {
      prompts.log.success(`Installed global Godot Editor plugin: ${pluginResult.targetPath}`);
    }
  } else if (key === "asepriteSource") {
    const bridge = await ensureGlobalAsepriteBridge();
    prompts.log.success(`Installed Aseprite live bridge: ${bridge.targetPath}`);
  }
  prompts.note(`${labelName.padEnd(14)} -> ${executablePath}`, "Saved to ~/.auvrynt/config.json");
  prompts.outro("Setup complete. Run `auvrynt status` to verify.");
}
