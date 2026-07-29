import * as prompts from "@clack/prompts";
import { resolve } from "node:path";
import type { InstanceLockRecord, StartRequest, TunnelProvider } from "../../background-lifecycle.js";
import { normalizeNgrokUrl, tunnelProviderLabel } from "../../tunnels/tunnel-utils.js";
import { loadAuvryntFiles, writeAuvryntConfig, type AuvryntUserConfig } from "../../user-config.js";

export interface ActiveInstance {
  stateDir: string;
  lockPath: string;
  record: InstanceLockRecord;
}

export interface TunnelCommandDependencies {
  readActiveInstance(): Promise<ActiveInstance | undefined>;
  restart(request: StartRequest, launchRoot: string, hard: boolean): Promise<void>;
}

export async function runTunnelCommand(dependencies: TunnelCommandDependencies): Promise<void> {
  const files = loadAuvryntFiles();
  const current: TunnelProvider = files.config.tunnelProvider ?? "cloudflare";

  prompts.intro("  Auvrynt tunnel provider  ");
  const picked = await prompts.select({
    message: `Select a tunnel provider  (current: ${tunnelProviderLabel(current)})`,
    options: [
      { value: "0", label: "0. Exit", hint: "make no changes" },
      { value: "1", label: "1. Cloudflare (CDN tunnel)", hint: current === "cloudflare" ? "current" : undefined },
      { value: "2", label: "2. ngrok", hint: current === "ngrok" ? "current" : undefined },
    ],
  });

  if (prompts.isCancel(picked) || picked === "0") {
    prompts.cancel("No changes made.");
    return;
  }

  const provider: TunnelProvider = picked === "2" ? "ngrok" : "cloudflare";
  let ngrokAuthtoken = files.config.ngrokAuthtoken;
  let ngrokUrl = files.config.ngrokUrl;

  if (provider === "ngrok" && !ngrokAuthtoken && !process.env.AUVRYNT_NGROK_AUTHTOKEN) {
    const answer = await prompts.text({
      message: "ngrok authtoken (leave blank if already set via `ngrok config add-authtoken`)",
      placeholder: "paste your ngrok authtoken, or press Enter to skip",
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    const trimmed = String(answer).trim();
    if (trimmed) ngrokAuthtoken = trimmed;
  }

  if (provider === "ngrok") {
    const answer = await prompts.text({
      message: "Stable ngrok HTTPS URL (optional; leave blank for an assigned URL)",
      placeholder: "https://your-name.ngrok.app",
      initialValue: ngrokUrl ?? "",
      validate: (value) => {
        try {
          normalizeNgrokUrl(String(value));
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Tunnel setup cancelled.");
      return;
    }
    ngrokUrl = normalizeNgrokUrl(String(answer));
  }

  const nextConfig: AuvryntUserConfig = { ...files.config, tunnelProvider: provider };
  if (ngrokAuthtoken) nextConfig.ngrokAuthtoken = ngrokAuthtoken;
  else delete nextConfig.ngrokAuthtoken;
  if (ngrokUrl) nextConfig.ngrokUrl = ngrokUrl;
  else delete nextConfig.ngrokUrl;
  writeAuvryntConfig(nextConfig);

  prompts.note(`Tunnel provider set to ${tunnelProviderLabel(provider)}.`, "Saved to ~/.auvrynt/config.json");

  const active = await dependencies.readActiveInstance();
  if (active) {
    const restart = await prompts.confirm({
      message: "Auvrynt is currently running. Restart it now to switch the live tunnel?",
      initialValue: true,
    });
    if (!prompts.isCancel(restart) && restart) {
      await dependencies.restart(
        { replace: true, backgroundChild: false },
        active.record.launchRoot ?? resolve(process.cwd()),
        true,
      );
      prompts.outro(`Restarted with the ${tunnelProviderLabel(provider)} tunnel.`);
      return;
    }
    prompts.outro("Run `auvrynt restart hard` when you're ready to apply this.");
    return;
  }

  prompts.outro("Run `auvrynt start` to launch with the new tunnel provider.");
}
