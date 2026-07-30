import { AUVRYNT_COMMANDS } from "../infrastructure/command-reference.js";
import { AUVRYNT_THEME_CSS } from "../ui/brand-theme.js";
import type { DashboardView } from "./dashboard.js";

const PAGE_META = {
  analytics: {
    kicker: "Operations",
    title: "Analytics",
    description: "",
  },
  connectivity: {
    kicker: "Configuration",
    title: "Connectivity",
    description: "Manage MCP endpoints, the active workspace, and local integrations.",
  },
  logs: {
    kicker: "Observability",
    title: "Logs",
    description: "Inspect MCP, tool, authentication, and lifecycle events.",
  },
  commands: {
    kicker: "Reference",
    title: "Commands",
    description: "Search the local Auvrynt command surface.",
  },
} as const;

export function dashboardHtml(view: DashboardView, nonce: string): string {
  const commands = commandMarkup();
  const initialData = jsonForHtml(view);
  const firstRoot = view.allowedRoots[0] ?? "";

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
      body { margin: 0; min-width: 320px; min-height: 100vh; color: var(--auvrynt-text); background: radial-gradient(circle at 72% -18%, rgba(192,132,252,.20), transparent 36%), radial-gradient(circle at -10% 86%, rgba(126,34,206,.14), transparent 34%), var(--auvrynt-bg-deep); font-family: var(--auvrynt-font-sans); }
      button, input { font: inherit; }
      button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--auvrynt-accent); outline-offset: 3px; }
      button:disabled { cursor: not-allowed; opacity: .58; }
      [hidden] { display: none !important; }
      .app-shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
      .control-rail { position: sticky; top: 0; display: flex; height: 100vh; min-width: 0; flex-direction: column; padding: 22px 16px 16px; border-right: 1px solid var(--auvrynt-border-soft); background: linear-gradient(180deg, rgba(30,11,54,.84), rgba(11,7,20,.92)); backdrop-filter: blur(24px); }
      .brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 20px; }
      .brand img { width: 38px; height: 38px; border-radius: 11px; box-shadow: 0 12px 28px rgba(5,2,12,.36); }
      .brand-name { display: block; font-size: 17px; font-weight: 780; letter-spacing: -.025em; }
      .brand-version { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
      .agent-presence { position: relative; margin: 0 2px 24px; padding: 15px 14px 14px; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; background: rgba(12,6,24,.42); overflow: hidden; }
      .agent-presence::after { position: absolute; inset: auto -30px -46px auto; width: 110px; height: 110px; border-radius: 50%; background: rgba(192,132,252,.12); filter: blur(18px); content: ""; }
      .presence-head { position: relative; z-index: 1; display: flex; align-items: center; gap: 9px; }
      .presence-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: var(--auvrynt-text-muted); box-shadow: 0 0 0 4px rgba(167,139,250,.08); }
      .agent-presence[data-state="working"] .presence-dot { background: var(--auvrynt-accent); animation: status-heartbeat 1.7s ease-in-out infinite; box-shadow: 0 0 18px rgba(192,132,252,.82); }
      .agent-presence[data-state="connected"] .presence-dot { background: var(--auvrynt-accent-soft); box-shadow: 0 0 14px rgba(216,180,254,.64); }
      .agent-presence[data-state="waiting"] .presence-dot { background: transparent; border: 1px solid var(--auvrynt-text-muted); }
      .agent-presence[data-state="stopping"] .presence-dot { background: var(--auvrynt-warning); box-shadow: 0 0 12px rgba(253,230,138,.38); }
      .presence-title { position: relative; z-index: 1; font-size: 12px; font-weight: 760; }
      .presence-detail { position: relative; z-index: 1; margin: 7px 0 0; color: var(--auvrynt-text-secondary); font-size: 10px; line-height: 1.45; }
      .rail-label { margin: 0 10px 8px; color: var(--auvrynt-text-muted); font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .dashboard-nav { display: grid; gap: 4px; }
      .nav-tab { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 10px; border: 0; border-radius: 10px; color: var(--auvrynt-text-secondary); background: transparent; cursor: pointer; text-align: left; transition: color 140ms ease-out, background 140ms ease-out, transform 140ms ease-out; }
      .nav-tab:hover { color: var(--auvrynt-text); background: rgba(192,132,252,.08); transform: translateX(2px); }
      .nav-tab[aria-selected="true"] { color: var(--auvrynt-text); background: rgba(192,132,252,.14); box-shadow: inset 0 0 0 1px rgba(216,180,254,.13); }
      .nav-icon { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.08); font: 11px var(--auvrynt-font-mono); }
      .nav-label { font-size: 12px; font-weight: 720; }
      .nav-count { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
      .rail-spacer { flex: 1; min-height: 24px; }
      .lifecycle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 14px; border-top: 1px solid var(--auvrynt-border-soft); }
      .button { position: relative; display: inline-flex; min-height: 38px; align-items: center; justify-content: center; gap: 7px; padding: 8px 12px; border: 1px solid var(--auvrynt-border); border-radius: 10px; color: var(--auvrynt-accent-soft); background: rgba(12,6,24,.36); cursor: pointer; font-size: 11px; font-weight: 760; transition: transform 130ms ease-out, background 130ms ease-out, border-color 130ms ease-out, box-shadow 130ms ease-out; }
      .button:hover:not(:disabled) { border-color: rgba(216,180,254,.56); background: rgba(192,132,252,.12); transform: translateY(-1px); }
      .button.primary { border-color: rgba(216,180,254,.58); color: var(--auvrynt-bg-deep); background: var(--auvrynt-accent-soft); box-shadow: 0 10px 24px rgba(192,132,252,.16); }
      .button.primary:hover:not(:disabled) { color: var(--auvrynt-bg-deep); background: #f3e8ff; }
      .button.stop { color: var(--auvrynt-danger); }
      .button.stop:hover:not(:disabled) { border-color: rgba(240,171,252,.62); background: rgba(240,171,252,.09); }
      .button[aria-busy="true"] { pointer-events: none; }
      .button[aria-busy="true"]::before { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: button-spin .72s linear infinite; content: ""; }
      .rail-meta { margin: 10px 2px 0; color: var(--auvrynt-text-muted); font: 9px/1.5 var(--auvrynt-font-mono); text-align: center; }
      .workspace { --workspace-gutter: 36px; min-width: 0; padding: 0 var(--workspace-gutter) 48px; }
      .workspace-header { position: sticky; z-index: 8; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 108px; margin-inline: calc(var(--workspace-gutter) * -1); padding: 22px var(--workspace-gutter) 18px; border-bottom: 1px solid var(--auvrynt-border-soft); background: linear-gradient(180deg, rgba(11,7,20,.98) 68%, rgba(11,7,20,.76)); backdrop-filter: blur(18px); }
      .page-kicker { margin: 0 0 5px; color: var(--auvrynt-accent); font-size: 10px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
      .page-title { margin: 0; font-size: clamp(28px, 3vw, 40px); line-height: 1; letter-spacing: -.04em; }
      .page-description { max-width: 62ch; margin: 8px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.5; }
      .server-state { display: flex; align-items: center; gap: 10px; padding: 8px 0; border: 0; background: transparent; }
      .server-state-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--auvrynt-accent); box-shadow: 0 0 12px rgba(192,132,252,.62); }
      .server-state-copy strong { display: block; font-size: 10px; }
      .server-state-copy small { display: block; margin-top: 2px; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
      .toast-region { position: fixed; z-index: 100; inset: auto 16px 24px; display: grid; place-items: center; pointer-events: none; }
      .toast { width: max-content; max-width: min(520px, calc(100vw - 32px)); padding: 11px 15px; border: 1px solid rgba(216,180,254,.28); border-radius: 12px; color: var(--auvrynt-text); background: rgba(24,10,43,.96); box-shadow: 0 18px 52px rgba(5,2,12,.46); opacity: 0; transform: translateY(14px) scale(.98); transition: opacity 180ms ease-out, transform 220ms cubic-bezier(.2,.8,.2,1); pointer-events: auto; font-size: 11px; line-height: 1.45; text-align: center; }
      .toast.visible { opacity: 1; transform: translateY(0) scale(1); }
      .toast.error { border-color: rgba(240,171,252,.48); color: var(--auvrynt-danger); background: rgba(42,12,50,.97); }
      .lifecycle-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(5,2,12,.82); backdrop-filter: blur(14px); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 180ms ease-out, visibility 180ms ease-out; }
      .lifecycle-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }
      .lifecycle-panel { position: relative; display: grid; width: min(360px, calc(100vw - 40px)); justify-items: center; gap: 14px; padding: 28px 24px 24px; overflow: hidden; border: 1px solid rgba(216,180,254,.26); border-radius: 18px; background: linear-gradient(155deg, rgba(30,11,54,.98), rgba(11,7,20,.99)); box-shadow: 0 28px 90px rgba(5,2,12,.68); text-align: center; animation: lifecycle-panel-in .34s cubic-bezier(.2,.8,.2,1) both, lifecycle-panel-breathe 2.8s ease-in-out .34s infinite; }
      .lifecycle-panel::before { position: absolute; inset: -35% -10% auto; height: 120px; background: radial-gradient(circle, rgba(192,132,252,.18), transparent 68%); filter: blur(10px); animation: lifecycle-glow 2.4s ease-in-out infinite; content: ""; pointer-events: none; }
      .lifecycle-spinner { position: relative; width: 46px; height: 46px; border: 3px solid rgba(216,180,254,.16); border-top-color: var(--auvrynt-accent-soft); border-radius: 50%; animation: button-spin .8s linear infinite, lifecycle-spinner-pulse 1.6s ease-in-out infinite; }
      .lifecycle-spinner::before { position: absolute; inset: -8px; border: 1px solid rgba(216,180,254,.12); border-radius: 50%; animation: lifecycle-ring 1.8s ease-out infinite; content: ""; }
      .lifecycle-spinner::after { position: absolute; inset: 8px; border: 2px solid rgba(192,132,252,.16); border-bottom-color: var(--auvrynt-accent); border-radius: 50%; animation: button-spin 1.15s linear infinite reverse; content: ""; }
      .lifecycle-title { position: relative; margin: 2px 0 0; font-size: 19px; letter-spacing: -.025em; animation: lifecycle-title-pulse 1.8s ease-in-out infinite; }
      .lifecycle-message { position: relative; margin: 0; color: var(--auvrynt-text-secondary); font-size: 11px; line-height: 1.55; animation: lifecycle-message-fade 2s ease-in-out infinite; }
      .lifecycle-progress { position: relative; width: 100%; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(216,180,254,.08); }
      .lifecycle-progress::before { display: block; width: 42%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, transparent, var(--auvrynt-accent-soft), transparent); animation: lifecycle-scan 1.15s ease-in-out infinite; content: ""; }
      .confirm-dialog { width: min(440px, calc(100vw - 32px)); padding: 0; border: 1px solid rgba(216,180,254,.28); border-radius: 16px; color: var(--auvrynt-text); background: linear-gradient(160deg, rgba(30,11,54,.98), rgba(11,7,20,.99)); box-shadow: 0 30px 90px rgba(5,2,12,.72); }
      .confirm-dialog::backdrop { background: rgba(5,2,12,.74); backdrop-filter: blur(8px); }
      .confirm-body { padding: 24px 24px 18px; }
      .confirm-kicker { margin: 0 0 8px; color: var(--auvrynt-accent); font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .confirm-title { margin: 0; font-size: 20px; letter-spacing: -.025em; }
      .confirm-message { margin: 12px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.6; }
      .confirm-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 14px 18px 18px; border-top: 1px solid rgba(216,180,254,.10); }
      .dashboard-view { min-width: 0; padding-top: 24px; }
      .analytics-lead { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr); gap: 18px; }
      .activity-surface, .change-surface { min-width: 0; border: 1px solid var(--auvrynt-border-soft); border-radius: 16px; background: rgba(18,8,34,.56); box-shadow: 0 22px 60px rgba(5,2,12,.22); }
      .activity-surface { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 236px; overflow: hidden; }
      .activity-copy { display: flex; min-width: 0; flex-direction: column; justify-content: space-between; padding: 26px 28px; }
      .surface-label { margin: 0 0 10px; color: var(--auvrynt-text-muted); font-size: 10px; font-weight: 760; }
      .agent-headline { margin: 0; max-width: 16ch; font-size: clamp(24px, 3vw, 38px); line-height: 1.05; letter-spacing: -.035em; }
      .agent-headline span { color: var(--auvrynt-accent-soft); }
      .agent-caption { max-width: 56ch; margin: 14px 0 0; color: var(--auvrynt-text-secondary); font-size: 12px; line-height: 1.55; }
      .activity-foot { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 24px; color: var(--auvrynt-text-muted); font: 10px var(--auvrynt-font-mono); }
      .change-surface { padding: 24px; background: linear-gradient(145deg, rgba(30,11,54,.82), rgba(12,6,24,.58)); }
      .change-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .change-head h2 { margin: 0; font-size: 15px; letter-spacing: -.02em; }
      .change-workspace { max-width: 26ch; margin: 6px 0 0; overflow: hidden; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-overflow: ellipsis; white-space: nowrap; }
      .change-sampled { flex: 0 0 auto; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
      .code-delta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); margin: 30px 0 24px; }
      .delta { min-width: 0; overflow: hidden; }
      .delta + .delta { padding-left: 18px; border-left: 1px solid var(--auvrynt-border-soft); }
      .delta strong { display: block; max-width: 100%; overflow: hidden; font-size: clamp(24px, 2.7vw, 40px); font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -.035em; text-overflow: ellipsis; white-space: nowrap; }
      .delta.add strong { color: var(--auvrynt-accent-soft); }
      .delta.remove strong { color: var(--auvrynt-danger); }
      .delta span { display: block; margin-top: 7px; color: var(--auvrynt-text-muted); font-size: 9px; }
      .file-delta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding-top: 16px; border-top: 1px solid var(--auvrynt-border-soft); }
      .file-delta strong { display: block; font-size: 16px; }
      .file-delta span { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; }
      .runtime-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 18px 0 0; border-top: 1px solid var(--auvrynt-border-soft); border-bottom: 1px solid var(--auvrynt-border-soft); }
      .runtime-metric { min-width: 0; padding: 18px 16px; }
      .runtime-metric + .runtime-metric { border-left: 1px solid var(--auvrynt-border-soft); }
      .runtime-metric span { display: block; color: var(--auvrynt-text-muted); font-size: 9px; font-weight: 760; }
      .runtime-metric strong { display: block; margin-top: 7px; overflow: hidden; font-size: 20px; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
      .operations-grid { display: grid; grid-template-columns: minmax(340px, .9fr) minmax(0, 1.1fr); gap: 18px; }
      .section-surface { min-width: 0; padding: 22px; border-top: 1px solid var(--auvrynt-border-soft); border-bottom: 1px solid var(--auvrynt-border-soft); background: rgba(12,6,24,.24); }
      .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
      .section-head h2 { margin: 0; font-size: 14px; letter-spacing: -.015em; }
      .section-head p { margin: 5px 0 0; color: var(--auvrynt-text-muted); font-size: 10px; }
      .section-action { min-height: 32px; padding: 6px 10px; }
      .connection-list { display: grid; gap: 0; }
      .connection-row { display: grid; grid-template-columns: 86px minmax(0, 1fr) 34px; align-items: center; gap: 10px; min-height: 49px; border-top: 1px solid rgba(216,180,254,.10); }
      .connection-row:first-child { border-top: 0; }
      .connection-label { color: var(--auvrynt-text-muted); font-size: 10px; }
      .connection-value { min-width: 0; overflow: hidden; color: var(--auvrynt-text-secondary); font: 10px var(--auvrynt-font-mono); text-overflow: ellipsis; white-space: nowrap; }
      .connection-value a { color: inherit; text-decoration: none; }
      .connection-value a:hover { color: var(--auvrynt-accent-soft); }
      .icon-button { display: grid; width: 31px; height: 31px; place-items: center; border: 1px solid transparent; border-radius: 9px; color: var(--auvrynt-text-muted); background: transparent; cursor: pointer; }
      .icon-button:hover { border-color: var(--auvrynt-border-soft); color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.08); }
      .icon-button.copied { color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.14); }
      .icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
      .icon-button[aria-busy="true"] svg { display: none; }
      .icon-button[aria-busy="true"]::after { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: button-spin .72s linear infinite; content: ""; }
      .session-limit-form { display: grid; grid-template-columns: minmax(0, 1fr) 52px 34px; align-items: center; gap: 8px; min-height: 54px; border-top: 1px solid rgba(216,180,254,.10); }
      .session-limit-copy strong { display: block; font-size: 11px; }
      .session-limit-copy small { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; line-height: 1.4; }
      .session-limit-input { width: 52px; min-height: 34px; padding: 7px 4px; border: 0; border-radius: 8px; outline: 0; color: var(--auvrynt-text); background: transparent; appearance: textfield; font: 11px var(--auvrynt-font-mono); text-align: center; }
      .session-limit-input:hover, .session-limit-input:focus { background: rgba(192,132,252,.08); }
      .session-limit-input::-webkit-inner-spin-button, .session-limit-input::-webkit-outer-spin-button { margin: 0; appearance: none; }
      .integration-list { display: grid; }
      .integration-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; min-height: 54px; border-top: 1px solid rgba(216,180,254,.10); }
      .integration-row:first-child { border-top: 0; }
      .integration-name strong { display: block; font-size: 11px; }
      .integration-name small { display: block; margin-top: 3px; color: var(--auvrynt-text-muted); font-size: 9px; line-height: 1.4; }
      .state { color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); text-transform: uppercase; }
      .state.connected { color: var(--auvrynt-accent-soft); text-shadow: 0 0 12px rgba(192,132,252,.32); }
      .state.available { color: var(--auvrynt-text-secondary); }
      .state.offline { color: var(--auvrynt-warning); }
      .integration-toggle { min-width: 76px; min-height: 32px; padding: 6px 9px; }
      .analytics-lower { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(250px, .65fr); gap: 18px; margin-top: 24px; }
      .analytics-panel { min-width: 0; padding: 20px 22px; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; background: rgba(12,6,24,.34); }
      .analytics-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .analytics-panel h3 { margin: 0; font-size: 12px; }
      .analytics-panel small { color: var(--auvrynt-text-muted); font-size: 9px; }
      .activity-chart { display: grid; grid-template-columns: repeat(12, minmax(5px, 1fr)); align-items: end; gap: 7px; height: 150px; margin: 20px 0 8px; padding-top: 8px; border-bottom: 1px solid var(--auvrynt-border-soft); }
      .activity-bar { height: 100%; min-height: 3px; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, var(--auvrynt-accent-soft), rgba(192,132,252,.28)); transform-origin: bottom; transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
      .activity-bar.level-0 { transform: scaleY(.03); } .activity-bar.level-1 { transform: scaleY(.1); } .activity-bar.level-2 { transform: scaleY(.2); } .activity-bar.level-3 { transform: scaleY(.3); } .activity-bar.level-4 { transform: scaleY(.4); } .activity-bar.level-5 { transform: scaleY(.5); } .activity-bar.level-6 { transform: scaleY(.6); } .activity-bar.level-7 { transform: scaleY(.7); } .activity-bar.level-8 { transform: scaleY(.8); } .activity-bar.level-9 { transform: scaleY(.9); } .activity-bar.level-10 { transform: scaleY(1); }
      .chart-axis { display: flex; justify-content: space-between; color: var(--auvrynt-text-muted); font: 9px var(--auvrynt-font-mono); }
      .analytics-stack { display: grid; gap: 18px; }
      .mix-list, .top-tools { display: grid; gap: 10px; margin-top: 15px; }
      .mix-row { display: grid; grid-template-columns: 62px minmax(0, 1fr) 28px; align-items: center; gap: 9px; }
      .mix-label, .mix-count { color: var(--auvrynt-text-secondary); font: 9px var(--auvrynt-font-mono); }
      .mix-count { text-align: right; }
      .mix-track { height: 5px; overflow: hidden; border-radius: 999px; background: rgba(216,180,254,.08); }
      .mix-fill { display: block; width: 100%; height: 100%; min-width: 2px; border-radius: inherit; background: var(--auvrynt-accent); transform-origin: left; transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
      .mix-fill.level-0 { transform: scaleX(.02); } .mix-fill.level-1 { transform: scaleX(.1); } .mix-fill.level-2 { transform: scaleX(.2); } .mix-fill.level-3 { transform: scaleX(.3); } .mix-fill.level-4 { transform: scaleX(.4); } .mix-fill.level-5 { transform: scaleX(.5); } .mix-fill.level-6 { transform: scaleX(.6); } .mix-fill.level-7 { transform: scaleX(.7); } .mix-fill.level-8 { transform: scaleX(.8); } .mix-fill.level-9 { transform: scaleX(.9); } .mix-fill.level-10 { transform: scaleX(1); }
      .top-tool { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding-top: 9px; border-top: 1px solid rgba(216,180,254,.08); color: var(--auvrynt-text-secondary); font: 9px var(--auvrynt-font-mono); }
      .top-tool:first-child { padding-top: 0; border-top: 0; }
      .top-tool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .analytics-empty { color: var(--auvrynt-text-muted); font-size: 10px; }
      .view-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
      .view-toolbar h2 { margin: 0; font-size: 14px; }
      .toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
      .search { width: min(320px, 100%); min-height: 38px; padding: 8px 11px; border: 1px solid var(--auvrynt-border); border-radius: 10px; color: var(--auvrynt-text); background: var(--auvrynt-code); }
      .search::placeholder { color: var(--auvrynt-text-muted); }
      .logs-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 320px) auto; gap: 12px; }
      .log-filter-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; }
      .filter { width: auto; min-height: 34px; padding: 6px 10px; border: 1px solid transparent; border-radius: 9px; color: var(--auvrynt-text-muted); background: transparent; cursor: pointer; font-size: 9px; font-weight: 760; text-align: center; text-transform: uppercase; }
      .filter:hover { color: var(--auvrynt-text-secondary); background: rgba(192,132,252,.05); }
      .filter.active { border-color: var(--auvrynt-border); color: var(--auvrynt-accent-soft); background: rgba(192,132,252,.09); }
      .logs-wrap { position: relative; min-width: 0; border: 1px solid var(--auvrynt-border-soft); border-radius: 14px; overflow: hidden; }
      .logs { height: calc(100vh - 220px); min-height: 420px; overflow: auto; background: rgba(8,4,16,.72); font-family: var(--auvrynt-font-mono); scrollbar-width: thin; scrollbar-color: rgba(192,132,252,.45) transparent; }
      .log-row { display: grid; grid-template-columns: 82px 54px minmax(150px, 220px) minmax(0, 1fr); gap: 10px; padding: 9px 12px; border-bottom: 1px solid rgba(216,180,254,.07); color: var(--auvrynt-text-secondary); font-size: 10px; line-height: 1.45; }
      .log-row:hover { background: rgba(192,132,252,.035); }
      .log-row time, .log-level { color: var(--auvrynt-text-muted); }
      .log-level.warn { color: var(--auvrynt-warning); }
      .log-level.error { color: var(--auvrynt-danger); }
      .log-event { color: var(--auvrynt-accent-soft); overflow-wrap: anywhere; }
      .log-fields { min-width: 0; color: var(--auvrynt-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
      .new-logs { position: absolute; z-index: 2; top: 10px; right: 12px; display: none; }
      .new-logs.visible { display: inline-flex; }
      .command-toolbar { margin-top: 4px; }
      .commands { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 2px 0 28px; }
      .command-column { display: flex; min-width: 0; flex-direction: column; gap: 22px; }
      .command-group h3 { margin: 0 0 8px; color: var(--auvrynt-accent-soft); font-size: 11px; }
      .command-row { display: grid; grid-template-columns: minmax(170px, .8fr) minmax(0, 1.2fr) auto; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid rgba(216,180,254,.09); }
      .command-row code { color: var(--auvrynt-accent-soft); font: 10px/1.5 var(--auvrynt-font-mono); overflow-wrap: anywhere; }
      .command-row span { color: var(--auvrynt-text-muted); font-size: 10px; line-height: 1.5; }

      .empty { padding: 34px 14px; color: var(--auvrynt-text-muted); text-align: center; }
      @keyframes status-heartbeat { 0%, 36%, 100% { transform: scale(1); box-shadow: 0 0 10px rgba(192,132,252,.46); } 9% { transform: scale(1.5); box-shadow: 0 0 24px rgba(192,132,252,.94); } 18% { transform: scale(1); } 27% { transform: scale(1.24); box-shadow: 0 0 17px rgba(192,132,252,.72); } }
      @keyframes button-spin { to { transform: rotate(360deg); } }
      @keyframes lifecycle-scan { 0% { transform: translateX(-120%); } 100% { transform: translateX(340%); } }
      @keyframes lifecycle-panel-in { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes lifecycle-panel-breathe { 0%, 100% { box-shadow: 0 28px 90px rgba(5,2,12,.68), 0 0 0 rgba(192,132,252,0); } 50% { box-shadow: 0 30px 100px rgba(5,2,12,.76), 0 0 34px rgba(192,132,252,.12); } }
      @keyframes lifecycle-glow { 0%, 100% { opacity: .5; transform: translateX(-8%) scale(.94); } 50% { opacity: 1; transform: translateX(8%) scale(1.08); } }
      @keyframes lifecycle-spinner-pulse { 0%, 100% { filter: drop-shadow(0 0 0 rgba(192,132,252,0)); } 50% { filter: drop-shadow(0 0 12px rgba(192,132,252,.42)); } }
      @keyframes lifecycle-ring { 0% { opacity: .7; transform: scale(.72); } 75%, 100% { opacity: 0; transform: scale(1.5); } }
      @keyframes lifecycle-title-pulse { 0%, 100% { opacity: .86; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-1px); } }
      @keyframes lifecycle-message-fade { 0%, 100% { opacity: .68; } 50% { opacity: 1; } }
      @media (max-width: 1180px) { .workspace { --workspace-gutter: 26px; } .analytics-lead { grid-template-columns: 1fr; } .change-surface { display: grid; grid-template-columns: minmax(180px, .5fr) minmax(0, 1fr); align-items: center; gap: 20px; } .code-delta { margin: 0; } .file-delta { padding-top: 0; padding-left: 20px; border-top: 0; border-left: 1px solid var(--auvrynt-border-soft); } .runtime-strip { grid-template-columns: repeat(3, 1fr); } .runtime-metric:nth-child(4) { border-left: 0; border-top: 1px solid var(--auvrynt-border-soft); } .runtime-metric:nth-child(5) { border-top: 1px solid var(--auvrynt-border-soft); } }
      @media (max-width: 940px) { .app-shell { grid-template-columns: 1fr; } .control-rail { position: static; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; height: auto; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--auvrynt-border-soft); } .brand { padding: 0; } .brand-version, .rail-label, .agent-presence, .rail-meta { display: none; } .dashboard-nav { display: flex; justify-content: center; gap: 4px; } .nav-tab { grid-template-columns: 24px auto; width: auto; min-height: 38px; padding: 6px 10px; } .nav-count { display: none; } .lifecycle { grid-template-columns: auto auto; padding: 0; border: 0; } .lifecycle .button { min-height: 36px; } .rail-spacer { display: none; } .workspace { --workspace-gutter: 22px; } .workspace-header { top: 63px; } .operations-grid, .analytics-lower { grid-template-columns: 1fr; } .logs-toolbar { grid-template-columns: minmax(0, 1fr) minmax(160px, 1fr) auto; gap: 10px; } }
      @media (max-width: 680px) { .control-rail { grid-template-columns: 1fr auto; gap: 10px; } .dashboard-nav { grid-column: 1 / -1; grid-row: 2; justify-content: stretch; overflow-x: auto; padding-top: 10px; } .nav-tab { flex: 1 0 auto; justify-content: center; } .brand-name { font-size: 15px; } .brand img { width: 34px; height: 34px; } .lifecycle .button { width: 36px; padding: 0; font-size: 0; } .lifecycle .button::after { font-size: 13px; } #restart::after { content: "↻"; } #stop::after { content: "■"; } .workspace { --workspace-gutter: 14px; padding-bottom: 32px; } .workspace-header { position: static; min-height: 0; padding-block: 24px 18px; } .server-state { display: none; } .page-title { font-size: 30px; } .analytics-lead { gap: 12px; } .activity-surface { grid-template-columns: 1fr; min-height: 0; } .activity-copy { padding: 22px; } .change-surface { display: block; padding: 20px; } .code-delta { margin: 24px 0 20px; } .file-delta { padding-top: 16px; padding-left: 0; border-top: 1px solid var(--auvrynt-border-soft); border-left: 0; } .runtime-strip { grid-template-columns: repeat(2, 1fr); } .runtime-metric:nth-child(3), .runtime-metric:nth-child(5) { border-left: 0; } .runtime-metric:nth-child(3), .runtime-metric:nth-child(4), .runtime-metric:nth-child(5) { border-top: 1px solid var(--auvrynt-border-soft); } .section-surface { padding: 18px 0; } .section-head { padding-inline: 2px; } .connection-row { grid-template-columns: 76px minmax(0, 1fr) 32px; } .session-limit-form { grid-template-columns: minmax(0, 1fr) 48px 34px; padding: 10px 0; } .integration-row { grid-template-columns: minmax(0, 1fr) auto; padding: 9px 0; } .integration-row .state { grid-column: 1; } .integration-toggle { grid-column: 2; grid-row: 1 / span 2; } .analytics-lower { margin-top: 18px; } .view-toolbar { align-items: stretch; flex-direction: column; } .logs-toolbar { grid-template-columns: minmax(0, auto) minmax(140px, 1fr) auto; gap: 6px; } .log-filter-row { overflow-x: auto; padding-bottom: 2px; } .toolbar-actions { justify-content: flex-start; } .search { width: 100%; } .filter { flex: 0 0 auto; padding-inline: 8px; } .logs { height: 62vh; min-height: 360px; } .log-row { grid-template-columns: 68px 46px minmax(0, 1fr); } .log-fields { grid-column: 1 / -1; } .commands { grid-template-columns: 1fr; } .command-row { grid-template-columns: 1fr auto; gap: 4px 10px; } .command-row span { grid-column: 1 / -1; } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        .button[aria-busy="true"]::before,
        .icon-button[aria-busy="true"]::after { animation: button-spin .72s linear infinite !important; }
        .lifecycle-spinner { animation: button-spin 1.15s linear infinite !important; }
        .lifecycle-spinner::after { animation: button-spin 1.6s linear infinite reverse !important; }
        .lifecycle-progress::before { animation: lifecycle-scan 1.8s ease-in-out infinite !important; }
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <aside class="control-rail" aria-label="Auvrynt controls">
        <div class="brand">
          <img src="/brand-assets/auvrynt-icon.png" alt="" width="38" height="38" />
          <div><span class="brand-name">Auvrynt</span><span class="brand-version">PID <span id="rail-pid">${view.pid}</span></span></div>
        </div>

        <section class="agent-presence" id="agent-presence" data-state="${view.agentState}" aria-live="polite">
          <div class="presence-head"><span class="presence-dot" aria-hidden="true"></span><strong class="presence-title" id="presence-title">${escapeHtml(agentStateLabel(view))}</strong></div>
          <p class="presence-detail" id="presence-detail">${escapeHtml(agentStateDetail(view))}</p>
        </section>

        <p class="rail-label">Workspace</p>
        <nav class="dashboard-nav" role="tablist" aria-label="Dashboard views" aria-orientation="vertical">
          <button class="nav-tab" id="tab-analytics" type="button" role="tab" aria-selected="true" aria-controls="view-analytics" data-view="analytics"><span class="nav-icon">A</span><span class="nav-label">Analytics</span><span class="nav-count" id="nav-session-count">${view.sessions}/${view.maxSessions}</span></button>
          <button class="nav-tab" id="tab-connectivity" type="button" role="tab" aria-selected="false" aria-controls="view-connectivity" data-view="connectivity"><span class="nav-icon">C</span><span class="nav-label">Connectivity</span><span class="nav-count">${view.integrations.filter((item) => item.enabled).length}</span></button>
          <button class="nav-tab" id="tab-logs" type="button" role="tab" aria-selected="false" aria-controls="view-logs" data-view="logs"><span class="nav-icon">L</span><span class="nav-label">Logs</span><span class="nav-count" id="nav-log-count">${view.logs.length}</span></button>
          <button class="nav-tab" id="tab-commands" type="button" role="tab" aria-selected="false" aria-controls="view-commands" data-view="commands"><span class="nav-icon">›_</span><span class="nav-label">Commands</span><span class="nav-count">${AUVRYNT_COMMANDS.length}</span></button>
        </nav>

        <div class="rail-spacer"></div>
        <div class="lifecycle">
          <button class="button primary" id="restart" type="button">Restart</button>
          <button class="button stop" id="stop" type="button">Stop</button>
        </div>
        <p class="rail-meta">Local control surface<br />Uptime <span id="rail-uptime">${escapeHtml(formatUptime(view.uptimeSeconds))}</span></p>
      </aside>

      <main class="workspace">
        <header class="workspace-header">
          <div>
            <p class="page-kicker" id="page-kicker">${PAGE_META.analytics.kicker}</p>
            <h1 class="page-title" id="page-title">${PAGE_META.analytics.title}</h1>
            <p class="page-description" id="page-description" hidden>${PAGE_META.analytics.description}</p>
          </div>
          <div class="server-state">
            <span class="server-state-dot" id="server-state-dot" aria-hidden="true"></span>
            <span class="server-state-copy"><strong id="server-state-title">Server online</strong><small id="server-state-detail">Refreshes every 2 seconds</small></span>
          </div>
        </header>

        <section class="dashboard-view" id="view-analytics" role="tabpanel" aria-labelledby="tab-analytics" data-view-panel="analytics">
          <div class="analytics-lead">
            <section class="activity-surface" id="activity-surface" data-agent-state="${view.agentState}">
              <div class="activity-copy">
                <div>
                  <p class="surface-label">Web agent presence</p>
                  <h2 class="agent-headline" id="agent-headline">${escapeHtml(agentHeadline(view))}</h2>
                  <p class="agent-caption" id="agent-caption">${escapeHtml(agentCaption(view))}</p>
                </div>
                <div class="activity-foot"><span id="agent-sessions">${view.sessions} active session${view.sessions === 1 ? "" : "s"}</span><span id="agent-tools">${view.activeToolCalls} tool call${view.activeToolCalls === 1 ? "" : "s"} running</span><span id="agent-last-seen">${escapeHtml(lastSeenLabel(view.agentLastSeenAt))}</span></div>
              </div>
            </section>

            <section class="change-surface" aria-labelledby="change-title">
              <div class="change-head"><div><p class="surface-label">Current workspace</p><h2 id="change-title">Agent changes</h2><p class="change-workspace" id="change-workspace" title="${escapeHtml(view.workspaceChanges.workspaceRoot ?? "No workspace opened")}">${escapeHtml(view.workspaceChanges.workspaceRoot ?? "No workspace opened")}</p></div><span class="change-sampled" id="change-sampled">${escapeHtml(agentChangeLabel(view.workspaceChanges.workspaceRoot, view.workspaceChanges.sampledAt))}</span></div>
              <div class="code-delta"><div class="delta add"><strong id="change-additions" title="+${view.workspaceChanges.additions.toLocaleString()}">+${escapeHtml(formatMetricNumber(view.workspaceChanges.additions))}</strong><span>Lines added</span></div><div class="delta remove"><strong id="change-removals" title="−${view.workspaceChanges.removals.toLocaleString()}">−${escapeHtml(formatMetricNumber(view.workspaceChanges.removals))}</strong><span>Lines removed</span></div></div>
              <div class="file-delta"><div><strong id="files-created">${view.workspaceChanges.filesCreated}</strong><span>Created</span></div><div><strong id="files-modified">${view.workspaceChanges.filesModified}</strong><span>Modified</span></div><div><strong id="files-deleted">${view.workspaceChanges.filesDeleted}</strong><span>Deleted</span></div></div>
            </section>
          </div>

          <div class="runtime-strip" aria-label="Runtime metrics">
            <div class="runtime-metric"><span>MCP sessions</span><strong id="metric-sessions">${view.sessions} / ${view.maxSessions}</strong></div>
            <div class="runtime-metric"><span>Managed processes</span><strong id="metric-processes">${view.runningProcesses}</strong></div>
            <div class="runtime-metric"><span>Tool calls sampled</span><strong id="metric-tools">0</strong></div>
            <div class="runtime-metric"><span>Average HTTP</span><strong id="metric-http">—</strong></div>
            <div class="runtime-metric"><span>Server uptime</span><strong id="metric-uptime">${escapeHtml(formatUptime(view.uptimeSeconds))}</strong></div>
          </div>

          <div class="analytics-lower">
            <section class="analytics-panel" aria-labelledby="activity-title">
              <div class="analytics-panel-head"><h3 id="activity-title">Operational activity</h3><small id="analytics-window">Latest 0 events</small></div>
              <div class="activity-chart" id="activity-chart" aria-label="Recent event activity chart"></div>
              <div class="chart-axis"><span>30m ago</span><span>15m</span><span>Now</span></div>
            </section>
            <div class="analytics-stack">
              <section class="analytics-panel" aria-labelledby="tools-title"><div class="analytics-panel-head"><h3 id="tools-title">Most used tools</h3><small>Current sample</small></div><div class="top-tools" id="top-tools"></div></section>
              <section class="analytics-panel" aria-labelledby="health-title"><div class="analytics-panel-head"><h3 id="health-title">Health signals</h3><small>Warnings and failures</small></div><div class="mix-list" id="health-signals"></div></section>
            </div>
          </div>
        </section>

        <section class="dashboard-view" id="view-connectivity" role="tabpanel" aria-labelledby="tab-connectivity" data-view-panel="connectivity" hidden>
          <div class="operations-grid">
            <section class="section-surface" aria-labelledby="connection-title">
              <div class="section-head"><div><h2 id="connection-title">Connection</h2><p>Endpoints and the root exposed to web agents.</p></div></div>
              <div class="connection-list">
                <div class="connection-row"><span class="connection-label">Local MCP</span><span class="connection-value"><a id="local-mcp" href="${escapeHtml(view.localMcpUrl)}">${escapeHtml(view.localMcpUrl)}</a></span><button class="icon-button" type="button" data-copy-url="local" aria-label="Copy Local MCP URL" title="Copy Local MCP URL">⧉</button></div>
                <div class="connection-row"><span class="connection-label">Public MCP</span><span class="connection-value"><a id="public-mcp" href="${escapeHtml(view.publicMcpUrl)}">${escapeHtml(view.publicMcpUrl)}</a></span><button class="icon-button" type="button" data-copy-url="public" aria-label="Copy Public MCP URL" title="Copy Public MCP URL">⧉</button></div>
                <div class="connection-row"><span class="connection-label">Workspace</span><span class="connection-value" id="workspace" title="${escapeHtml(firstRoot)}">${escapeHtml(firstRoot || "No workspace configured")}</span><button class="icon-button" id="edit-workspace" type="button" aria-label="Choose workspace folder" title="Choose workspace folder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.75a1.75 1.75 0 0 1-1.75 1.75H5.25a1.75 1.75 0 0 1-1.75-1.75z"/><path d="M3.5 9h17"/></svg></button></div>
                <form class="session-limit-form" id="session-limit-form"><div class="session-limit-copy"><strong>MCP session limit</strong></div><input class="session-limit-input" id="session-limit-input" type="text" inputmode="numeric" pattern="(?:[1-9]|[1-9][0-9])" maxlength="2" value="${view.maxSessions}" aria-label="Maximum concurrent MCP sessions" /><button class="icon-button" id="save-session-limit" type="submit" aria-label="Apply MCP session limit" title="Apply MCP session limit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 3 3"/></svg></button></form>
              </div>
            </section>

            <section class="section-surface" aria-labelledby="integrations-title">
              <div class="section-head"><div><h2 id="integrations-title">Integrations</h2><p>Availability and live bridge state.</p></div></div>
              <div class="integration-list" id="integrations"></div>
            </section>
          </div>
        </section>

        <section class="dashboard-view" id="view-logs" role="tabpanel" aria-labelledby="tab-logs" data-view-panel="logs" hidden>
          <div class="view-toolbar logs-toolbar"><h2>Recent events</h2><input class="search" id="log-search" type="search" placeholder="Search logs…" autocomplete="off" /><div class="log-filter-row" role="group" aria-label="Log categories"><button class="filter active" data-log-filter="all" type="button">All</button><button class="filter" data-log-filter="tool" type="button">Tool</button><button class="filter" data-log-filter="mcp" type="button">MCP</button><button class="filter" data-log-filter="http" type="button">HTTP</button><button class="filter" data-log-filter="auth" type="button">Auth</button><button class="filter" data-log-filter="error" type="button">Error</button></div></div>
          <div class="logs-wrap"><button class="button new-logs" id="new-logs" type="button"></button><div class="logs" id="log-list" tabindex="0" aria-label="Recent Auvrynt logs"></div></div>
        </section>

        <section class="dashboard-view" id="view-commands" role="tabpanel" aria-labelledby="tab-commands" data-view-panel="commands" hidden>
          <div class="view-toolbar command-toolbar"><div><h2>Command reference</h2><p class="page-description">Browse Auvrynt commands and copy them for use in a local terminal.</p></div><input class="search" id="command-search" type="search" placeholder="Filter commands…" autocomplete="off" /></div>
          <div class="commands" id="command-list">${commands}</div>
        </section>
      </main>
    </div>

    <div class="lifecycle-overlay" id="lifecycle-overlay" role="status" aria-live="assertive" aria-hidden="true"><div class="lifecycle-panel"><div class="lifecycle-spinner" aria-hidden="true"></div><h2 class="lifecycle-title" id="lifecycle-title">Restarting Auvrynt</h2><p class="lifecycle-message" id="lifecycle-message">Please wait while local services reconnect.</p><div class="lifecycle-progress" aria-hidden="true"></div></div></div>
    <dialog class="confirm-dialog" id="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message"><div class="confirm-body"><p class="confirm-kicker">Auvrynt control</p><h2 class="confirm-title" id="confirm-title">Confirm action</h2><p class="confirm-message" id="confirm-message"></p></div><div class="confirm-actions"><button class="button" id="confirm-cancel" type="button">Cancel</button><button class="button primary" id="confirm-accept" type="button">Continue</button></div></dialog>
    <div class="toast-region" aria-live="polite" aria-atomic="true"><div class="toast" id="action-notice" role="status"></div></div>

    <script nonce="${escapeHtml(nonce)}">
      (() => {
        const pageMeta = ${jsonForHtml(PAGE_META)};
        let state = ${initialData};
        let activeFilter = "all";
        let knownNewestId = state.logs[0]?.id ?? 0;
        let unseenLogs = 0;
        let lifecycleMode = null;
        let refreshFailures = 0;
        const viewNames = ["analytics", "connectivity", "logs", "commands"];
        let activeView = viewNames.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "analytics";
        const logs = document.getElementById("log-list");
        const integrations = document.getElementById("integrations");
        const notice = document.getElementById("action-notice");
        const newLogs = document.getElementById("new-logs");
        const logSearch = document.getElementById("log-search");
        const activityChart = document.getElementById("activity-chart");
        const topTools = document.getElementById("top-tools");
        const healthSignals = document.getElementById("health-signals");
        const restartButton = document.getElementById("restart");
        const stopButton = document.getElementById("stop");
        const lifecycleOverlay = document.getElementById("lifecycle-overlay");
        const lifecycleTitle = document.getElementById("lifecycle-title");
        const lifecycleMessage = document.getElementById("lifecycle-message");
        const confirmDialog = document.getElementById("confirm-dialog");
        const confirmTitle = document.getElementById("confirm-title");
        const confirmMessage = document.getElementById("confirm-message");
        const confirmCancel = document.getElementById("confirm-cancel");
        const confirmAccept = document.getElementById("confirm-accept");
        const sessionLimitForm = document.getElementById("session-limit-form");
        const sessionLimitInput = document.getElementById("session-limit-input");
        const saveSessionLimitButton = document.getElementById("save-session-limit");
        let confirmResolver = null;
        let refreshTimer = null;

        const category = (entry) => {
          const event = entry.event.toLowerCase();
          if (entry.level === "error") return "error";
          if (event.includes("tool")) return "tool";
          if (event.includes("mcp") || event.includes("session")) return "mcp";
          if (event.includes("auth") || event.includes("oauth") || event.includes("token")) return "auth";
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
        const relativeTime = (value) => {
          if (!value) return "No agent activity yet";
          const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
          if (seconds < 5) return "Active just now";
          if (seconds < 60) return "Active " + seconds + "s ago";
          if (seconds < 3600) return "Active " + Math.floor(seconds / 60) + "m ago";
          return "Active " + Math.floor(seconds / 3600) + "h ago";
        };
        const levelClass = (value, maximum) => "level-" + Math.max(0, Math.min(10, maximum > 0 ? Math.round((value / maximum) * 10) : 0));
        const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const exactNumber = (value) => new Intl.NumberFormat().format(Math.max(0, Number(value) || 0));
        const compactNumber = (value) => {
          const normalized = Math.max(0, Number(value) || 0);
          return normalized < 100000
            ? exactNumber(normalized)
            : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(normalized);
        };
        let toastTimer = null;

        function showToast(message, tone = "info", duration = 3200) {
          if (toastTimer) window.clearTimeout(toastTimer);
          toastTimer = null;
          notice.textContent = message;
          notice.classList.toggle("error", tone === "error");
          notice.classList.remove("visible");
          void notice.offsetWidth;
          notice.classList.add("visible");
          if (duration > 0) {
            toastTimer = window.setTimeout(() => {
              notice.classList.remove("visible");
              toastTimer = null;
              window.setTimeout(() => {
                if (!notice.classList.contains("visible")) notice.textContent = "";
              }, 240);
            }, duration);
          }
        }

        function finishConfirmation(accepted) {
          const resolve = confirmResolver;
          confirmResolver = null;
          if (confirmDialog.open) confirmDialog.close();
          resolve?.(accepted);
        }

        function confirmAction(title, message, acceptLabel = "Continue") {
          if (confirmResolver) finishConfirmation(false);
          confirmTitle.textContent = title;
          confirmMessage.textContent = message;
          confirmAccept.textContent = acceptLabel;
          confirmDialog.showModal();
          confirmCancel.focus();
          return new Promise((resolve) => { confirmResolver = resolve; });
        }

        function setChangeMetric(id, value, prefix) {
          const element = document.getElementById(id);
          const exact = prefix + exactNumber(value);
          element.textContent = prefix + compactNumber(value);
          element.title = exact;
          element.setAttribute("aria-label", exact);
        }

        function agentText(nextState) {
          const provider = nextState.agentProvider || "AI agent";
          if (nextState.agentState === "working") return { title: provider + " working", headline: provider + " is actively using Auvrynt.", caption: nextState.activeToolCalls + " tool call" + (nextState.activeToolCalls === 1 ? " is" : "s are") + " executing now." };
          if (nextState.agentState === "connected") return { title: provider + " connected", headline: provider + " is connected and ready.", caption: nextState.sessions + " authenticated MCP session" + (nextState.sessions === 1 ? " is" : "s are") + " currently open." };
          if (nextState.agentState === "stopping") return { title: "Server stopping", headline: "Auvrynt is closing active connections.", caption: "The dashboard will stop refreshing when shutdown completes." };
          return { title: "Waiting for AI", headline: "Auvrynt is online and ready.", caption: "Connect ChatGPT, Claude, or another MCP-compatible AI client." };
        }

        function setActiveView(view, updateHash = true) {
          activeView = viewNames.includes(view) ? view : "analytics";
          document.querySelectorAll("[data-view]").forEach((tab) => {
            const selected = tab.dataset.view === activeView;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
          });
          document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== activeView; });
          document.getElementById("page-kicker").textContent = pageMeta[activeView].kicker;
          document.getElementById("page-title").textContent = pageMeta[activeView].title;
          const pageDescription = document.getElementById("page-description");
          pageDescription.textContent = pageMeta[activeView].description;
          pageDescription.hidden = !pageMeta[activeView].description;
          if (updateHash) window.history.replaceState(null, "", "#" + activeView);
        }

        function renderAgentPresence() {
          const copy = agentText(state);
          const presence = document.getElementById("agent-presence");
          presence.dataset.state = state.agentState;
          document.getElementById("presence-title").textContent = copy.title;
          document.getElementById("presence-detail").textContent = state.agentState === "waiting" ? copy.caption : relativeTime(state.agentLastSeenAt);
          const activitySurface = document.getElementById("activity-surface");
          activitySurface.dataset.agentState = state.agentState;
          document.getElementById("agent-headline").textContent = copy.headline;
          document.getElementById("agent-caption").textContent = copy.caption;
          document.getElementById("agent-sessions").textContent = state.sessions + " active session" + (state.sessions === 1 ? "" : "s");
          document.getElementById("agent-tools").textContent = state.activeToolCalls + " tool call" + (state.activeToolCalls === 1 ? "" : "s") + " running";
          document.getElementById("agent-last-seen").textContent = relativeTime(state.agentLastSeenAt);
          document.getElementById("nav-session-count").textContent = state.sessions + "/" + state.maxSessions;
          if (document.activeElement !== sessionLimitInput && !sessionLimitInput.disabled) {
            sessionLimitInput.value = String(state.maxSessions);
          }
        }

        function operationalEntries() {
          return state.logs.filter((entry) => {
            if (entry.event !== "http_request") return true;
            const path = typeof entry.fields.path === "string" ? entry.fields.path : "";
            return !path.startsWith("/dashboard") && !path.startsWith("/brand-assets/");
          });
        }

        function renderAnalytics() {
          const entries = operationalEntries();
          const toolCalls = entries.filter((entry) => entry.event === "tool_call");
          const errors = entries.filter((entry) => entry.level === "error");
          const httpDurations = entries.filter((entry) => entry.event === "http_request" && Number.isFinite(Number(entry.fields.durationMs))).map((entry) => Number(entry.fields.durationMs));
          const averageHttp = httpDurations.length ? httpDurations.reduce((total, value) => total + value, 0) / httpDurations.length : null;

          document.getElementById("metric-sessions").textContent = state.sessions + " / " + state.maxSessions;
          document.getElementById("metric-processes").textContent = String(state.runningProcesses);
          document.getElementById("metric-tools").textContent = String(toolCalls.length);
          document.getElementById("metric-http").textContent = averageHttp === null ? "—" : averageHttp < 1000 ? Math.round(averageHttp) + "ms" : (averageHttp / 1000).toFixed(1) + "s";
          document.getElementById("metric-uptime").textContent = uptime(state.uptimeSeconds);
          document.getElementById("rail-uptime").textContent = uptime(state.uptimeSeconds);
          document.getElementById("rail-pid").textContent = String(state.pid);
          document.getElementById("analytics-window").textContent = "Latest " + entries.length + " operational events";
          document.getElementById("nav-log-count").textContent = String(state.logs.length);

          const changes = state.workspaceChanges;
          setChangeMetric("change-additions", changes.additions, "+");
          setChangeMetric("change-removals", changes.removals, "−");
          document.getElementById("files-created").textContent = exactNumber(changes.filesCreated);
          document.getElementById("files-modified").textContent = exactNumber(changes.filesModified);
          document.getElementById("files-deleted").textContent = exactNumber(changes.filesDeleted);
          const changedWorkspace = changes.workspaceRoot || "No workspace opened";
          const changedWorkspaceElement = document.getElementById("change-workspace");
          changedWorkspaceElement.textContent = changedWorkspace;
          changedWorkspaceElement.title = changedWorkspace;
          document.getElementById("change-sampled").textContent = changes.workspaceRoot
            ? "Auvrynt · " + relativeTime(changes.sampledAt).replace("Active", "Updated")
            : "No agent changes yet";

          const now = Date.now();
          const windowMs = 30 * 60 * 1000;
          const bucketCount = 12;
          const bucketMs = windowMs / bucketCount;
          const bucketStart = now - windowMs;
          const buckets = Array.from({ length: bucketCount }, () => 0);
          entries.forEach((entry) => {
            const timestamp = Date.parse(entry.ts);
            if (!Number.isFinite(timestamp) || timestamp < bucketStart || timestamp > now) return;
            const index = Math.min(bucketCount - 1, Math.floor((timestamp - bucketStart) / bucketMs));
            buckets[index] += 1;
          });
          const peak = Math.max(1, ...buckets);
          activityChart.innerHTML = buckets.map((count, index) => '<span class="activity-bar ' + levelClass(count, peak) + '" title="Bucket ' + (index + 1) + ': ' + count + ' events"></span>').join("");

          const toolCounts = new Map();
          toolCalls.forEach((entry) => {
            const tool = typeof entry.fields.tool === "string" ? entry.fields.tool : "unknown";
            toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
          });
          const rankedTools = [...toolCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 6);
          topTools.innerHTML = rankedTools.length ? rankedTools.map(([name, count]) => '<div class="top-tool"><span class="top-tool-name" title="' + escape(name) + '">' + escape(name) + '</span><strong>' + count + '</strong></div>').join("") : '<div class="analytics-empty">No tool calls in the current sample.</div>';

          const health = [
            ["Warnings", entries.filter((entry) => entry.level === "warn").length],
            ["Errors", errors.length],
            ["Failed tools", toolCalls.filter((entry) => entry.fields.success === false).length],
            ["Closed sessions", entries.filter((entry) => entry.event === "mcp_session_closed").length],
          ];
          const healthPeak = Math.max(1, ...health.map((item) => item[1]));
          healthSignals.innerHTML = health.map(([name, count]) => '<div class="mix-row"><span class="mix-label">' + escape(name) + '</span><span class="mix-track"><span class="mix-fill ' + levelClass(count, healthPeak) + '"></span></span><span class="mix-count">' + count + '</span></div>').join("");
        }

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
            const entryCategory = category(entry);
            if (activeFilter === "error" && entry.level !== "error") return false;
            if (activeFilter !== "all" && activeFilter !== "error" && entryCategory !== activeFilter) return false;
            return !query || (entry.ts + " " + entry.level + " " + entry.event + " " + JSON.stringify(entry.fields)).toLowerCase().includes(query);
          });
          logs.innerHTML = visible.length ? visible.map((entry) => '<div class="log-row" data-log-id="' + entry.id + '"><time>' + time(entry.ts) + '</time><span class="log-level ' + entry.level + '">' + escape(entry.level.toUpperCase()) + '</span><span class="log-event">' + escape(entry.event) + '</span><span class="log-fields">' + escape(Object.keys(entry.fields).length ? JSON.stringify(entry.fields) : "") + '</span></div>').join("") : '<div class="empty">No matching events.</div>';
          if (atTop) { logs.scrollTop = 0; unseenLogs = 0; }
          else if (anchor) {
            const anchored = logs.querySelector('[data-log-id="' + anchor.id + '"]');
            if (anchored) logs.scrollTop = anchored.offsetTop - anchor.offset;
          }
          updateNewLogButton();
        }

        function renderIntegrations() {
          integrations.innerHTML = state.integrations.map((item) => '<div class="integration-row"><div class="integration-name"><strong>' + escape(item.label) + '</strong><small>' + escape(item.detail) + '</small></div><span class="state ' + item.state + '">' + escape(item.state) + '</span><button class="button integration-toggle" type="button" data-integration="' + escape(item.key) + '" data-enabled="' + item.enabled + '">' + (item.enabled ? "Disable" : "Enable") + '</button></div>').join("");
        }

        function renderConnection() {
          const local = document.getElementById("local-mcp");
          const publicUrl = document.getElementById("public-mcp");
          local.textContent = state.localMcpUrl;
          local.href = state.localMcpUrl;
          publicUrl.textContent = state.publicMcpUrl;
          publicUrl.href = state.publicMcpUrl;
          const root = state.allowedRoots[0] || "No workspace configured";
          const workspace = document.getElementById("workspace");
          workspace.textContent = root + (state.allowedRoots.length > 1 ? " +" + (state.allowedRoots.length - 1) : "");
          workspace.title = state.allowedRoots.join("\\n");
        }

        function renderServerState() {
          const title = document.getElementById("server-state-title");
          const detail = document.getElementById("server-state-detail");
          const dot = document.getElementById("server-state-dot");
          if (lifecycleMode === "restarting") { title.textContent = "Restarting"; detail.textContent = "Waiting for Auvrynt to return"; dot.style.background = "var(--auvrynt-warning)"; return; }
          if (lifecycleMode === "stopping" || !state.ready) { title.textContent = "Stopping"; detail.textContent = "Closing local services"; dot.style.background = "var(--auvrynt-warning)"; return; }
          title.textContent = "Server online";
          detail.textContent = "Refreshes every 2 seconds";
          dot.style.background = "var(--auvrynt-accent)";
        }

        function renderState(nextState) {
          const previousNewestId = knownNewestId;
          state = nextState;
          knownNewestId = state.logs[0]?.id ?? previousNewestId;
          if (knownNewestId > previousNewestId && logs.scrollTop > 4) unseenLogs += state.logs.filter((entry) => entry.id > previousNewestId).length;
          renderAgentPresence();
          renderConnection();
          renderIntegrations();
          renderAnalytics();
          renderLogs();
          renderServerState();
        }

        async function refresh() {
          if (lifecycleMode) return;
          try {
            const response = await fetch("/dashboard/data", {
              cache: "no-store",
              signal: AbortSignal.timeout(3_000),
            });
            if (!response.ok) throw new Error("Dashboard refresh failed (" + response.status + ")");
            const nextState = await response.json();
            refreshFailures = 0;
            renderState(nextState);
          } catch {
            refreshFailures += 1;
            if (refreshFailures >= 3) {
              const title = document.getElementById("server-state-title");
              const detail = document.getElementById("server-state-detail");
              const dot = document.getElementById("server-state-dot");
              title.textContent = "Reconnecting";
              detail.textContent = "Waiting for dashboard data";
              dot.style.background = "var(--auvrynt-warning)";
            }
          }
        }

        async function postAction(path, body) {
          const response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", "x-auvrynt-dashboard": "1" },
            body: JSON.stringify(body ?? {}),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Action failed (" + response.status + ")");
          return result;
        }

        function setButtonBusy(button, busy, label) {
          if (!button.dataset.label) button.dataset.label = button.textContent;
          button.setAttribute("aria-busy", String(busy));
          button.disabled = busy;
          button.textContent = busy ? label : button.dataset.label;
        }

        function beginLifecycle(mode, message) {
          lifecycleMode = mode;
          if (refreshTimer) window.clearInterval(refreshTimer);
          restartButton.disabled = true;
          stopButton.disabled = true;
          document.documentElement.setAttribute("aria-busy", "true");
          lifecycleTitle.textContent = mode === "restarting" ? "Restarting Auvrynt" : "Stopping Auvrynt";
          lifecycleMessage.textContent = mode === "restarting"
            ? "Please wait. The dashboard and public URL will reconnect automatically."
            : "Please wait while active connections and local services close safely.";
          lifecycleOverlay.classList.add("active");
          lifecycleOverlay.setAttribute("aria-hidden", "false");
          state = { ...state, ready: false, agentState: "stopping" };
          showToast(message, "info", 0);
          renderAgentPresence();
          renderServerState();
        }

        function endLifecycle() {
          lifecycleMode = null;
          document.documentElement.removeAttribute("aria-busy");
          lifecycleOverlay.classList.remove("active");
          lifecycleOverlay.setAttribute("aria-hidden", "true");
        }

        async function waitForRestart() {
          const previousPid = state.pid;
          let sawOffline = false;
          const deadline = Date.now() + 90_000;
          let attempt = 0;
          while (Date.now() < deadline) {
            attempt += 1;
            await delay(Math.min(500 + attempt * 75, 1_500));
            try {
              const response = await fetch("/healthz?restart=" + Date.now(), {
                cache: "no-store",
                signal: AbortSignal.timeout(3_000),
              });
              if (!response.ok) { sawOffline = true; continue; }
              const health = await response.json().catch(() => ({}));
              const pidChanged = typeof health.pid === "number" && health.pid !== previousPid;
              if (sawOffline || pidChanged) {
                const dashboardResponse = await fetch("/dashboard/data?restart=" + Date.now(), {
                  cache: "no-store",
                  signal: AbortSignal.timeout(3_000),
                });
                if (!dashboardResponse.ok) continue;
                const nextState = await dashboardResponse.json();
                renderState(nextState);
                endLifecycle();
                restartButton.disabled = false;
                stopButton.disabled = false;
                setButtonBusy(restartButton, false, "");
                refreshTimer = window.setInterval(refresh, 2_000);
                showToast("Auvrynt restarted successfully.", "info", 2400);
                return;
              }
            } catch {
              sawOffline = true;
            }
          }
          endLifecycle();
          restartButton.disabled = false;
          stopButton.disabled = false;
          setButtonBusy(restartButton, false, "");
          showToast("Restart did not complete. The existing public URL was preserved; check Auvrynt status, then retry.", "error", 0);
          refreshTimer = window.setInterval(refresh, 2_000);
          void refresh();
        }

        document.querySelectorAll("[data-view]").forEach((tab) => {
          tab.addEventListener("click", () => setActiveView(tab.dataset.view));
          tab.addEventListener("keydown", (event) => {
            const horizontal = window.matchMedia("(max-width: 940px)").matches;
            const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
            const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
            if (event.key !== previousKey && event.key !== nextKey) return;
            event.preventDefault();
            const direction = event.key === nextKey ? 1 : -1;
            const nextIndex = (viewNames.indexOf(activeView) + direction + viewNames.length) % viewNames.length;
            setActiveView(viewNames[nextIndex]);
            document.querySelector('[data-view="' + activeView + '"]').focus();
          });
        });
        window.addEventListener("hashchange", () => setActiveView(window.location.hash.slice(1), false));

        confirmCancel.addEventListener("click", () => finishConfirmation(false));
        confirmAccept.addEventListener("click", () => finishConfirmation(true));
        confirmDialog.addEventListener("cancel", (event) => { event.preventDefault(); finishConfirmation(false); });
        confirmDialog.addEventListener("click", (event) => {
          if (event.target === confirmDialog) finishConfirmation(false);
        });

        integrations.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-integration]");
          if (!button) return;
          const enabled = button.dataset.enabled === "true";
          const label = button.closest(".integration-row")?.querySelector("strong")?.textContent || "integration";
          if (enabled && !await confirmAction("Disable " + label + "?", "Active operations for this integration may be interrupted.", "Disable")) return;
          setButtonBusy(button, true, enabled ? "Disabling" : "Enabling");
          try {
            const result = await postAction("/__auvrynt/dashboard/integrations", { integration: button.dataset.integration, enabled: !enabled });
            showToast(result.message || "Integration updated.");
            await refresh();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(button, false, "");
          }
        });

        restartButton.addEventListener("click", async () => {
          if (!await confirmAction("Restart Auvrynt?", "Connected AI clients may briefly lose access while the server restarts.", "Restart")) return;
          setButtonBusy(restartButton, true, "Restarting");
          try {
            const result = await postAction("/__auvrynt/dashboard/restart", {});
            beginLifecycle("restarting", result.message || "Restarting Auvrynt… The public MCP URL will stay the same.");
            void waitForRestart();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(restartButton, false, "");
            stopButton.disabled = false;
          }
        });

        stopButton.addEventListener("click", async () => {
          if (!await confirmAction("Stop Auvrynt?", "Connected AI clients will lose access until Auvrynt is started again.", "Stop")) return;
          setButtonBusy(stopButton, true, "Stopping");
          try {
            const result = await postAction("/__auvrynt/dashboard/stop", {});
            beginLifecycle("stopping", result.message || "Auvrynt is stopping…");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
            setButtonBusy(stopButton, false, "");
            restartButton.disabled = false;
          }
        });

        const editWorkspaceButton = document.getElementById("edit-workspace");
        editWorkspaceButton.addEventListener("click", async () => {
          editWorkspaceButton.disabled = true;
          editWorkspaceButton.setAttribute("aria-busy", "true");
          try {
            const selected = await postAction("/__auvrynt/dashboard/select-workspace", {});
            if (selected.canceled || !selected.path) return;
            const result = await postAction("/__auvrynt/dashboard/workspace", { path: selected.path });
            state.allowedRoots = result.allowedRoots || [selected.path];
            renderConnection();
            showToast(result.message || "Workspace changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            editWorkspaceButton.disabled = Boolean(lifecycleMode);
            editWorkspaceButton.setAttribute("aria-busy", "false");
          }
        });

        sessionLimitForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const maxSessions = Number(sessionLimitInput.value);
          if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 99) {
            showToast("MCP session limit must be between 1 and 99.", "error");
            sessionLimitInput.focus();
            return;
          }
          if (maxSessions === state.maxSessions) {
            showToast("MCP session limit is already " + maxSessions + ".");
            return;
          }
          saveSessionLimitButton.disabled = true;
          saveSessionLimitButton.setAttribute("aria-busy", "true");
          sessionLimitInput.disabled = true;
          try {
            const result = await postAction("/__auvrynt/dashboard/session-limit", { maxSessions });
            state.maxSessions = result.maxSessions;
            renderAgentPresence();
            renderAnalytics();
            showToast(result.message || "MCP session limit changed.");
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          } finally {
            saveSessionLimitButton.disabled = false;
            saveSessionLimitButton.setAttribute("aria-busy", "false");
            sessionLimitInput.disabled = false;
          }
        });

        async function copyText(text, button, successMessage) {
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "✓";
            button.classList.add("copied");
            showToast(successMessage);
          } catch (error) {
            showToast("Failed to copy: " + error.message, "error");
          }
        }

        document.querySelectorAll("[data-copy-url]").forEach((button) => button.addEventListener("click", () => {
          void copyText(button.dataset.copyUrl === "local" ? state.localMcpUrl : state.publicMcpUrl, button, "URL copied.");
        }));

        document.getElementById("command-search").addEventListener("input", (event) => {
          const query = event.target.value.trim().toLowerCase();
          document.querySelectorAll("[data-command-search]").forEach((row) => { row.hidden = Boolean(query && !row.dataset.commandSearch.includes(query)); });
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

        setActiveView(activeView, false);
        renderState(state);
        refreshTimer = window.setInterval(refresh, 2000);
      })();
    </script>
  </body>
</html>`;
}

function commandMarkup(): string {
  const groups = groupCommands();
  const columns: Array<Array<[string, typeof AUVRYNT_COMMANDS[number][]]>> = [[], []];
  const weights = [0, 0];
  for (const entry of groups.entries()) {
    const index = weights[0] <= weights[1] ? 0 : 1;
    columns[index].push(entry);
    weights[index] += entry[1].length + 1;
  }
  return columns.map((column) => `<div class="command-column">${column.map(([group, items]) => `<section class="command-group" data-command-group><h3>${escapeHtml(group)}</h3>${items.map(commandRowMarkup).join("")}</section>`).join("")}</div>`).join("");
}

function commandRowMarkup(item: typeof AUVRYNT_COMMANDS[number]): string {
  return `<div class="command-row" data-command-search="${escapeHtml(`${item.command} ${item.description}`.toLowerCase())}"><code>${escapeHtml(item.command)}</code><span>${escapeHtml(item.description)}</span></div>`;
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

function agentStateLabel(view: DashboardView): string {
  const provider = view.agentProvider ?? "AI agent";
  if (view.agentState === "working") return `${provider} working`;
  if (view.agentState === "connected") return `${provider} connected`;
  if (view.agentState === "stopping") return "Server stopping";
  return "Waiting for AI";
}

function agentStateDetail(view: DashboardView): string {
  if (view.agentState === "working") return `${view.activeToolCalls} active tool call${view.activeToolCalls === 1 ? "" : "s"}.`;
  if (view.agentState === "connected") return `${view.sessions} authenticated MCP session${view.sessions === 1 ? "" : "s"}.`;
  if (view.agentState === "stopping") return "Closing local services and sessions.";
  return "No authenticated MCP session is connected.";
}

function agentHeadline(view: DashboardView): string {
  const provider = view.agentProvider ?? "An AI client";
  if (view.agentState === "working") return `${provider} is actively using Auvrynt.`;
  if (view.agentState === "connected") return `${provider} is connected and ready.`;
  if (view.agentState === "stopping") return "Auvrynt is closing active connections.";
  return "Auvrynt is online and ready.";
}

function agentCaption(view: DashboardView): string {
  if (view.agentState === "working") return `${view.activeToolCalls} tool call${view.activeToolCalls === 1 ? " is" : "s are"} executing now.`;
  if (view.agentState === "connected") return `${view.sessions} authenticated MCP session${view.sessions === 1 ? " is" : "s are"} currently open.`;
  if (view.agentState === "stopping") return "The dashboard will stop refreshing when shutdown completes.";
  return "Connect ChatGPT, Claude, or another MCP-compatible AI client.";
}

function lastSeenLabel(value: string | undefined): string {
  if (!value) return "No agent activity yet";
  return "Active just now";
}

function agentChangeLabel(workspaceRoot: string | undefined, value: string): string {
  return workspaceRoot && value ? "Auvrynt · updated now" : "No agent changes yet";
}

function formatMetricNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (normalized < 100_000) return normalized.toLocaleString();
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(normalized);
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
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
