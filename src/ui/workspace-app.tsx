import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  isEditTool,
  isExpandableCard,
  isReadTool,
  isReviewTool,
  isSearchTool,
  isShellTool,
  isToolName,
  isToolResultCard,
  isWriteTool,
  payloadText,
  summaryNumber,
  type HostContext,
  type ToolName,
  type ToolResultCard,
} from "./card-types.js";
import "./workspace-app.css";

interface ToolDisplay {
  icon: string;
  title: string;
  label: string;
  tone: string;
}

interface MountedPayload {
  update(options: {
    card: ToolResultCard;
    hostContext?: HostContext;
    errorMessage?: string | null;
    visibleFileCount?: number;
  }): void;
  unmount(): void;
}

let app: App | null = null;
let connected = false;
let connectionError: string | null = null;
let hostContext: HostContext | undefined;
let card: ToolResultCard | null = null;
let expanded = false;
let reviewFilesExpanded = false;
let errorMessage: string | null = null;
let currentPayload: MountedPayload | null = null;
let currentPayloadContainer: HTMLElement | null = null;

const maybeAppRoot = document.querySelector<HTMLElement>("#app");

if (!maybeAppRoot) {
  throw new Error("Missing #app root element.");
}

const appRoot = maybeAppRoot;

void boot();

async function boot(): Promise<void> {
  const previewCard = previewCardFromLocation();
  if (previewCard) {
    connected = true;
    card = previewCard;
    render();
    return;
  }

  render();

  app = new App(
    { name: "auvrynt-tool-cards", version: "0.6.0" },
    {},
  );

  app.ontoolresult = (result) => {
    const structuredContent = getStructuredContent<Partial<ToolResultCard>>(result);
    const metaCard = cardFromMeta(result);
    const structured = metaCard
      ? { ...structuredContent, ...metaCard }
      : structuredContent;
    const tool = toolNameFromMeta(result);

    if (!tool || !isToolResultCard(structured)) {
      card = null;
      expanded = false;
      reviewFilesExpanded = false;
      errorMessage = "No result card is available for this tool result.";
      render();
      return;
    }

    card = { ...structured, tool };
    expanded = false;
    reviewFilesExpanded = false;
    errorMessage = null;
    render();
  };

  app.onhostcontextchanged = (ctx) => {
    hostContext = {
      ...hostContext,
      ...ctx,
    };
    applyHostContext();
    renderPayloadIfNeeded();
  };

  app.onteardown = async () => {
    unmountPayload();
    return {};
  };

  try {
    await app.connect();
    const initialContext = app.getHostContext();
    if (initialContext) hostContext = initialContext;
    applyHostContext();
    connected = true;
  } catch (connectError) {
    connectionError = connectError instanceof Error
      ? connectError.message
      : String(connectError);
  }

  render();
}

function previewCardFromLocation(): ToolResultCard | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "1") return null;

  const requestedTool = params.get("tool") ?? "read_file";
  const tool: ToolName = isToolName(requestedTool) ? requestedTool : "read_file";
  const path = params.get("path") ?? "KNOWN_ISSUES.md";
  const lines = Math.max(0, Number(params.get("lines") ?? "42") || 0);

  return {
    tool,
    path,
    status: "success",
    summary: { lines },
    payload: {
      content: [
        {
          type: "text",
          text: "This is the exact Auvrynt tool-card bundle currently built by the project. Expand the card to preview its payload area.",
        },
      ],
    },
  };
}

function applyHostContext(): void {
  if (hostContext?.theme) applyDocumentTheme(hostContext.theme);
  if (hostContext?.styles?.variables) {
    applyHostStyleVariables(hostContext.styles.variables);
  }
  if (hostContext?.styles?.css?.fonts) {
    applyHostFonts(hostContext.styles.css.fonts);
  }

  const insets = hostContext?.safeAreaInsets;
  if (!insets) return;

  document.body.style.padding = `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`;
}

function render(): void {
  unmountPayload();

  if (connectionError) {
    renderEmpty("Connection unavailable", connectionError, "error");
    return;
  }

  if (!connected) {
    renderEmpty("Connecting to Auvrynt", "Establishing a secure link with the host.", "loading");
    return;
  }

  if (!card) {
    renderEmpty(
      errorMessage ? "Tool result unavailable" : "Waiting for tool result",
      errorMessage ?? "Auvrynt will display the next tool response here.",
      errorMessage ? "error" : "loading",
    );
    return;
  }

  const display = getToolDisplay(card);
  if (isReviewTool(card.tool)) {
    renderReviewCard(card, display);
    return;
  }

  const expandable = isExpandableCard(card);
  const main = element("main", { className: "shell" });
  const section = element("section", { className: `tool-card ${display.tone}` });
  const button = element("button", {
    className: "tool-header",
    type: "button",
    ariaExpanded: String(expanded),
    disabled: !expandable,
  });

  if (expandable) {
    button.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
  }

  const icon = element("span", { className: "tool-icon", ariaHidden: "true" });
  icon.innerHTML = display.icon;

  const toolMain = element("span", { className: "tool-main" });
  const title = element("span", { className: "tool-title", text: display.title });
  const label = element("span", {
    className: "tool-label",
    text: display.label,
    title: display.label,
  });
  toolMain.append(title, label);

  button.append(
    icon,
    toolMain,
    renderSummaryBadge(card),
    renderChevron(expanded, expandable),
  );
  section.append(button);

  if (expanded) {
    const body = element("div", { className: "tool-body" });
    currentPayloadContainer = body;
    section.append(body);
  }

  main.append(section);
  appRoot.replaceChildren(main);
  renderPayloadIfNeeded();
}

function renderEmpty(
  title: string,
  detail: string,
  tone: "loading" | "error" | "muted" = "muted",
): void {
  const main = element("main", { className: "shell" });
  const section = element("section", { className: `empty ${tone}` });
  section.setAttribute("role", tone === "error" ? "alert" : "status");
  section.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");

  const indicator = element("span", { className: "empty-indicator", ariaHidden: "true" });
  const copy = element("span", { className: "empty-copy" });
  copy.append(
    element("span", { className: "empty-title", text: title }),
    element("span", { className: "empty-detail", text: detail, title: detail }),
  );
  section.append(indicator, copy);
  main.append(section);
  appRoot.replaceChildren(main);
}

async function renderPayloadIfNeeded(): Promise<void> {
  if (!card || !currentPayloadContainer || (!expanded && !isReviewTool(card.tool))) return;

  const target = currentPayloadContainer;

  if (errorMessage) {
    renderStatus(target, errorMessage, "error");
    return;
  }

  if (card.tool === "open_workspace") {
    renderPrePayload(target, workspacePayloadText(card), "open_workspace");
    return;
  }

  if (shouldUseHeavyPayload(card)) {
    if (currentPayload) {
      currentPayload.update({ card, hostContext, errorMessage });
      return;
    }

    renderStatus(target, "Loading details...");

    const { mountHeavyPayload } = await import("./heavy-payload.js");
    if (target !== currentPayloadContainer || !expanded || !card) return;

    currentPayload = mountHeavyPayload(target, {
      card,
      hostContext,
      errorMessage,
    });
    return;
  }

  if (isReviewTool(card.tool)) {
    const visibleFileCount = reviewFilesExpanded
      ? undefined
      : Math.max(3, (card.files ?? []).slice(0, 3).length);

    if (currentPayload) {
      currentPayload.update({ card, hostContext, errorMessage, visibleFileCount });
      return;
    }

    renderStatus(target, "Loading review...");

    const { mountReviewPayload } = await import("./review-payload.js");
    if (target !== currentPayloadContainer || !card) return;

    currentPayload = mountReviewPayload(target, {
      card,
      hostContext,
      errorMessage,
      visibleFileCount,
    });
    return;
  }

  const text = payloadText(card.payload);
  if (!text) {
    renderStatus(target, "No details available.");
    return;
  }

  renderPrePayload(target, text, card.tool);
}

function shouldUseHeavyPayload(card: ToolResultCard): boolean {
  return isReadTool(card.tool) || isEditTool(card.tool) || isWriteTool(card.tool);
}

function unmountPayload(): void {
  unmountCurrentPayload();
  currentPayload = null;
  currentPayloadContainer = null;
}

function unmountCurrentPayload(): void {
  currentPayload?.unmount();
  currentPayload = null;
}

function renderStatus(
  container: HTMLElement,
  message: string,
  tone: "muted" | "error" = "muted",
): void {
  unmountCurrentPayload();
  container.replaceChildren(element("div", { className: `status ${tone}`, text: message }));
}

function renderPrePayload(
  container: HTMLElement,
  text: string,
  tool: string,
): void {
  unmountCurrentPayload();
  container.replaceChildren(element("pre", { className: `text-payload ${tool}`, text }));
}

function renderSummaryBadge(card: ToolResultCard): HTMLElement {
  const summary = card.summary ?? {};

  if (isReviewTool(card.tool)) {
    const stats = element("span", { className: "stats" });
    stats.setAttribute("aria-label", "Review diff statistics");
    stats.append(
      element("span", { className: "add", text: `+${String(summary.additions ?? 0)}` }),
      element("span", { className: "remove", text: `-${String(summary.removals ?? 0)}` }),
    );
    return stats;
  }

  if (isEditTool(card.tool) || isWriteTool(card.tool)) {
    const stats = element("span", { className: "stats" });
    stats.setAttribute("aria-label", "Diff statistics");
    stats.append(
      element("span", { className: "add", text: `+${String(summary.additions ?? 0)}` }),
      element("span", { className: "remove", text: `-${String(summary.removals ?? 0)}` }),
    );
    return stats;
  }

  if (card.tool === "open_workspace") {
    const agentsFiles = summaryNumber(summary, "agentsFiles") ?? 0;
    const skills = summaryNumber(summary, "skills") ?? 0;
    const group = element("span", { className: "badge-group" });
    group.setAttribute("aria-label", "Workspace summary");

    const agentsBadge = element("span", {
      className: `badge ${agentsFiles > 0 ? "success" : "muted"}`,
      text: agentsFiles > 0 ? "AGENTS.md" : "No AGENTS.md",
    });
    if (agentsFiles > 0) {
      agentsBadge.insertAdjacentHTML("afterbegin", checkCircleIcon());
    }

    group.append(agentsBadge, element("span", { className: "badge", text: `${skills} skills` }));
    return group;
  }

  if (isShellTool(card.tool)) {
    return element("span", { className: "badge", text: `ran · ${String(summary.lines ?? 0)} lines` });
  }

  if (isSearchTool(card.tool)) {
    return element("span", { className: "badge", text: `${String(summary.lines ?? 0)} lines` });
  }

  return element("span", { className: "badge", text: `${String(summary.lines ?? 0)} lines` });
}

function renderReviewCard(card: ToolResultCard, display: ToolDisplay): void {
  unmountPayload();

  const files = card.files ?? [];
  const summary = card.summary ?? {};
  const visibleFiles = reviewFilesExpanded ? files : files.slice(0, 3);
  const hiddenCount = Math.max(0, files.length - visibleFiles.length);
  const main = element("main", { className: "shell" });
  const section = element("section", { className: "tool-card review" });
  const header = element("div", { className: "review-header" });
  const icon = element("span", { className: "tool-icon", ariaHidden: "true" });
  icon.innerHTML = display.icon;
  const titleGroup = element("div", { className: "review-title-group" });

  titleGroup.append(
    element("span", { className: "tool-title", text: display.title }),
    element("span", { className: "tool-label", text: display.label, title: display.label }),
  );
  header.append(icon, titleGroup, renderSummaryBadge(card));

  const body = element("div", { className: "review-summary" });
  currentPayloadContainer = body;

  const actions = element("div", { className: "review-actions" });
  if (hiddenCount > 0) {
    const showMore = element("button", {
      className: "review-action",
      type: "button",
      text: `Show ${hiddenCount} more ${hiddenCount === 1 ? "file" : "files"}`,
    });
    showMore.addEventListener("click", () => {
      reviewFilesExpanded = true;
      render();
    });
    actions.append(showMore);
  }

  section.append(header, body);
  if (actions.childElementCount > 0) {
    section.append(actions);
  }

  main.append(section);
  appRoot.replaceChildren(main);
  renderPayloadIfNeeded();
}

function renderChevron(isExpanded: boolean, visible: boolean): HTMLElement {
  const chevron = element("span", {
    className: visible ? `chevron ${isExpanded ? "expanded" : ""}` : "chevron",
    ariaHidden: "true",
  });

  if (visible) {
    chevron.innerHTML = iconSvg('<path d="m6 9 6 6 6-6" />');
  }

  return chevron;
}

function workspacePayloadText(card: ToolResultCard): string {
  const agentsFiles = card.agentsFiles ?? [];
  const availableAgentsFiles = card.availableAgentsFiles ?? [];
  const skills = card.skills ?? [];
  const lines = [
    card.workspaceId ? `Workspace: ${card.workspaceId}` : undefined,
    card.root ? `Root: ${card.root}` : undefined,
    skills.length > 0
      ? `Skills: ${skills.map((skill) => skill.name ?? skill.path ?? "unnamed").join(", ")}`
      : "Skills: none",
    availableAgentsFiles.length > 0
      ? `Nested instructions: ${availableAgentsFiles.map((file) => file.path ?? "unknown").join(", ")}`
      : undefined,
    agentsFiles.length > 0
      ? `\n${formatAgentsFilesForPayload(agentsFiles)}`
      : "\nAGENTS.md: none loaded",
  ].filter((line): line is string => typeof line === "string");

  return lines.join("\n");
}

function formatAgentsFilesForPayload(
  agentsFiles: NonNullable<ToolResultCard["agentsFiles"]>,
): string {
  return agentsFiles
    .map((file) => {
      const path = file.path ?? "AGENTS.md";
      const content = file.content?.trim();
      return content ? `${path}\n\n${content}` : `${path}\n\nNo content loaded.`;
    })
    .join("\n\n");
}

function getToolDisplay(card: ToolResultCard): ToolDisplay {
  const label = getToolLabel(card);

  switch (card.tool) {
    case "open_workspace":
      return { icon: folderIcon(), title: "Workspace", label, tone: "workspace" };
    case "read_file":
    case "read":
      return { icon: fileIcon(), title: "Read File", label, tone: "read" };
    case "write_file":
    case "write":
      return { icon: filePlusIcon(), title: "Write File", label, tone: "write" };
    case "edit_file":
    case "edit":
      return { icon: editIcon(), title: "Edit File", label, tone: "edit" };
    case "grep_files":
    case "grep":
      return { icon: searchIcon(), title: "Grep", label, tone: "search" };
    case "find_files":
    case "glob":
      return { icon: filesIcon(), title: "Glob", label, tone: "search" };
    case "list_directory":
    case "ls":
      return { icon: listIcon(), title: "List Directory", label, tone: "directory" };
    case "run_shell":
    case "bash":
      return { icon: terminalIcon(), title: "Bash", label, tone: "shell" };
    case "show_changes":
      return { icon: reviewIcon(), title: "Show Changes", label, tone: "review" };
    case "view_image":
      return { icon: fileIcon(), title: "View Image", label, tone: "read" };
    case "start_process":
    case "stop_process":
    case "start_dev_server":
    case "dotnet_run":
    case "godot_run":
      return { icon: terminalIcon(), title: card.tool === "start_dev_server" ? "Dev Server" : card.tool === "dotnet_run" ? "dotnet run" : card.tool === "godot_run" ? "Godot Run" : card.tool === "stop_process" ? "Stop Process" : "Start Process", label, tone: "shell" };
    case "get_process_logs":
    case "list_processes":
      return { icon: listIcon(), title: card.tool === "list_processes" ? "List Processes" : "Process Logs", label, tone: "directory" };
    case "glob_files":
    case "search_text":
    case "inspect_project":
      return { icon: searchIcon(), title: card.tool === "glob_files" ? "Glob Files" : card.tool === "search_text" ? "Search Text" : "Inspect Project", label, tone: "search" };
    case "capture_page_screenshot":
    case "capture_window":
    case "godot_capture_game":
      return { icon: fileIcon(), title: card.tool === "capture_page_screenshot" ? "Page Screenshot" : card.tool === "godot_capture_game" ? "Godot Capture" : "Window Capture", label, tone: "write" };
    case "inspect_page":
    case "inspect_image":
    case "inspect_sprite":
    case "inspect_godot_scene":
    case "inspect_dotnet_project":
    case "detect_godot_project":
      return { icon: fileIcon(), title: card.tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), label, tone: "read" };
    case "compare_images":
    case "split_sprite_sheet":
    case "dotnet_restore":
    case "dotnet_build":
    case "dotnet_test":
    case "dotnet_format":
      return { icon: terminalIcon(), title: card.tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), label, tone: "shell" };
    default:
      return { icon: terminalIcon(), title: card.tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), label, tone: "shell" };
  }
}

function getToolLabel(card: ToolResultCard): string {
  if (isShellTool(card.tool)) {
    return String(card.summary?.command ?? card.path ?? card.tool);
  }
  if (isReviewTool(card.tool)) {
    const count = Number(card.summary?.files ?? card.files?.length ?? 0);
    return count === 0 ? "No changes since last review" : `${count} changed ${count === 1 ? "file" : "files"}`;
  }
  if (card.path) return card.path;
  if (card.root) return card.root;
  if (isSearchTool(card.tool)) {
    return String(card.summary?.pattern ?? card.tool);
  }

  return card.tool;
}

function toolNameFromMeta(result: CallToolResult): ToolName | undefined {
  const meta = result._meta as Record<string, unknown> | undefined;
  const tool = meta?.tool;
  return isToolName(tool) ? tool : undefined;
}

function cardFromMeta(result: CallToolResult): Partial<ToolResultCard> | undefined {
  const meta = result._meta as Record<string, unknown> | undefined;
  const metaCard = meta?.card;
  return metaCard && typeof metaCard === "object" ? metaCard : undefined;
}

function getStructuredContent<T>(result: CallToolResult): T | undefined {
  return result.structuredContent as T | undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    type?: string;
    title?: string;
    ariaHidden?: string;
    ariaExpanded?: string;
    disabled?: boolean;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type !== undefined && "type" in node) node.setAttribute("type", options.type);
  if (options.title !== undefined) node.title = options.title;
  if (options.ariaHidden !== undefined) node.setAttribute("aria-hidden", options.ariaHidden);
  if (options.ariaExpanded !== undefined) node.setAttribute("aria-expanded", options.ariaExpanded);
  if (options.disabled !== undefined && "disabled" in node) {
    (node as HTMLButtonElement).disabled = options.disabled;
  }
  return node;
}

function iconSvg(children: string): string {
  return `<svg aria-hidden="true" class="icon-svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">${children}</svg>`;
}

function folderIcon(): string {
  return iconSvg('<path d="M3 7.5h6l2 2h10" /><path d="M3 7.5v10A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-8H3" />');
}

function fileIcon(): string {
  return iconSvg('<path d="M14 3v5h5" /><path d="M6 3h8l5 5v13H6z" /><path d="M9 13h6" /><path d="M9 17h4" />');
}

function filePlusIcon(): string {
  return iconSvg('<path d="M14 3v5h5" /><path d="M6 3h8l5 5v13H6z" /><path d="M12 12v6" /><path d="M9 15h6" />');
}

function editIcon(): string {
  return iconSvg('<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" />');
}

function searchIcon(): string {
  return iconSvg('<circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" />');
}

function filesIcon(): string {
  return iconSvg('<path d="M8 7V4h9l4 4v10h-3" /><path d="M12 4v5h5" /><path d="M4 7h9l4 4v10H4z" /><path d="M13 7v5h4" />');
}

function checkCircleIcon(): string {
  return '<svg aria-hidden="true" class="badge-icon" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="8" cy="8" r="6" /><path d="m5.5 8 1.7 1.7 3.4-3.5" /></svg>';
}

function listIcon(): string {
  return iconSvg('<path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><path d="M4 6h.01" /><path d="M4 12h.01" /><path d="M4 18h.01" />');
}

function terminalIcon(): string {
  return iconSvg('<path d="m5 7 5 5-5 5" /><path d="M12 17h7" />');
}

function reviewIcon(): string {
  return iconSvg('<path d="M5 4h14v16H5z" /><path d="M8 8h8" /><path d="M8 12h5" /><path d="M8 16h7" />');
}
