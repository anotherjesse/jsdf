import type { Node } from "../core/nodes";
import { childMatchesFilter, type GraphModel } from "./graph-model";
import {
  graphVisibilityMeta,
  graphVisibilityStateForPath,
  renderEyeIcon,
} from "./graph-visibility";
import type { SoloPreview } from "./solo-preview";

export interface GraphTreeRenderOptions {
  container: HTMLElement;
  root: Node;
  model: GraphModel;
  hiddenNodeIds: ReadonlySet<number>;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;
  focusHoverNodeId: number | null;
  lockedSoloNodeId: number | null;
  dirtyNodeIds: ReadonlySet<number>;
  filter: string;
  nodeKeyboardShortcuts(node: Node): string;
  soloPreviewForNode(node: Node): SoloPreview | null;
  onSelect(node: Node): void;
  onToggleVisibility(node: Node, options?: { focus?: boolean; isolate?: boolean }): void;
  onToggleLockedSolo(node: Node): void;
  onShowAllNodes(options?: { focus?: boolean }): void;
  onKeyDown(event: KeyboardEvent, node: Node): void;
  attachSoloHover(target: Element, path: Node[]): void;
}

export function renderGraphTree(options: GraphTreeRenderOptions): void {
  options.container.replaceChildren();
  if (options.model.visibleNodeIds.size === 0) {
    const empty = document.createElement("div");
    empty.className = "param-empty graph-empty";
    empty.textContent = "No matching nodes";
    options.container.append(empty);
    return;
  }

  options.container.append(
    renderTreeHeader(options),
    renderNode(options.root, 0, [options.root], String(options.root.id), options),
  );
}

function renderTreeHeader(options: GraphTreeRenderOptions): HTMLElement {
  const header = document.createElement("div");
  header.className = "graph-tree-header";

  const hidden = options.hiddenNodeIds.size;
  const visibility = document.createElement("button");
  visibility.type = "button";
  visibility.className = "graph-tree-header-eye";
  visibility.disabled = hidden === 0;
  visibility.title = hidden === 0 ? "Visibility" : "Show all hidden nodes (Shift+V)";
  visibility.setAttribute("aria-label", hidden === 0 ? "Visibility column" : "Show all hidden graph nodes");
  visibility.setAttribute("aria-keyshortcuts", "Shift+V");
  visibility.append(renderEyeIcon("visible"));
  if (hidden > 0) {
    const count = document.createElement("span");
    count.className = "visibility-count graph-tree-header-eye-count";
    count.setAttribute("aria-hidden", "true");
    count.textContent = hidden > 99 ? "99+" : String(hidden);
    visibility.append(count);
    visibility.addEventListener("click", () => options.onShowAllNodes({ focus: true }));
  }

  const rule = document.createElement("div");
  rule.className = "graph-tree-header-rule";
  rule.setAttribute("aria-hidden", "true");

  header.append(visibility, rule);
  return header;
}

function renderNode(
  node: Node,
  depth: number,
  path: Node[],
  instanceKey: string,
  options: GraphTreeRenderOptions,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "graph-node-group";
  const view = options.model.nodeById.get(node.id);

  const row = document.createElement("div");
  row.className = "graph-node-row";
  row.style.setProperty("--depth", String(depth));

  const { isRoot, directlyHidden, inheritedHidden } = graphVisibilityStateForPath(options.root, options.hiddenNodeIds, node, path);
  const effectivelyHidden = directlyHidden || inheritedHidden;
  const visibilityMeta = graphVisibilityMeta(isRoot, directlyHidden, inheritedHidden);
  row.dataset.visibilityState = visibilityMeta.state;
  if (effectivelyHidden) row.classList.add("hidden-node-row");
  if (inheritedHidden && !directlyHidden) row.classList.add("inherited-hidden");

  const visibility = document.createElement("button");
  visibility.type = "button";
  visibility.className = "graph-visibility";
  visibility.disabled = visibilityMeta.disabled;
  visibility.dataset.state = visibilityMeta.state;
  if (inheritedHidden && !directlyHidden) visibility.classList.add("inherited-hidden");
  visibility.title = visibilityShortcutTitle(visibilityMeta.title);
  visibility.setAttribute("aria-label", `${visibility.title} ${node.kind} #${node.id}`);
  visibility.setAttribute("aria-keyshortcuts", "V");
  visibility.setAttribute("aria-pressed", String(visibilityMeta.pressed));
  visibility.append(renderEyeIcon(visibilityMeta.state));
  visibility.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onToggleVisibility(node, { isolate: event.altKey });
  });

  const soloPreview = options.soloPreviewForNode(node);
  const isolate = document.createElement("button");
  isolate.type = "button";
  isolate.className = "graph-isolate";
  isolate.disabled = !soloPreview;
  isolate.title = soloPreview ? "Isolate this node in preview (I)" : "This node cannot be isolated";
  isolate.setAttribute("aria-label", soloPreview ? `Isolate ${node.kind} #${node.id} in preview` : `${node.kind} #${node.id} cannot be isolated`);
  isolate.setAttribute("aria-pressed", String(soloPreview ? node.id === options.lockedSoloNodeId : false));
  if (soloPreview) isolate.setAttribute("aria-keyshortcuts", "I");
  isolate.append(renderIsolateIcon(), screenReaderText("Isolate"));
  isolate.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onToggleLockedSolo(node);
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = "graph-node";
  if (effectivelyHidden) button.classList.add("hidden-node");
  if (inheritedHidden && !directlyHidden) button.classList.add("inherited-hidden");
  if (options.filter && view?.matched) button.classList.add("matched");
  if (options.hoveredNodeId === node.id) button.classList.add("hovered");
  if (options.focusHoverNodeId === node.id) button.classList.add("focus-peek");
  if (options.lockedSoloNodeId === node.id) button.classList.add("isolated");
  if (options.dirtyNodeIds.has(node.id)) button.classList.add("edited");
  button.setAttribute("aria-pressed", String(options.selectedNodeId === node.id));
  button.setAttribute("aria-selected", String(options.selectedNodeId === node.id));
  button.setAttribute("aria-keyshortcuts", options.nodeKeyboardShortcuts(node));
  button.id = graphNodeElementId(instanceKey);
  button.setAttribute("role", "treeitem");
  button.dataset.nodeId = String(node.id);
  const label = document.createElement("span");
  label.textContent = node.kind;
  const meta = document.createElement("small");
  const shared = (view?.parents.size ?? 0) > 1;
  meta.textContent = `#${node.id} ${node.dim}D${shared ? " shared" : ""}${options.dirtyNodeIds.has(node.id) ? " edited" : ""}${directlyHidden ? " hidden" : inheritedHidden ? " parent hidden" : ""}`;
  button.append(label, meta);
  button.addEventListener("click", () => options.onSelect(node));
  button.addEventListener("keydown", (event) => options.onKeyDown(event, node));
  options.attachSoloHover(row, path);
  row.append(visibility, button, isolate);
  group.append(row);

  node.children.forEach((child, childIndex) => {
    if (childMatchesFilter(child.node, options.model.visibleNodeIds)) {
      group.append(renderNode(
        child.node,
        depth + 1,
        [...path, child.node],
        `${instanceKey}-${childIndex}-${child.node.id}`,
        options,
      ));
    }
  });
  return group;
}

function graphNodeElementId(instanceKey: string): string {
  return `graph-node-${instanceKey}`;
}

function renderIsolateIcon(): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "isolate-icon";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function screenReaderText(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "sr-only";
  span.textContent = text;
  return span;
}

function visibilityShortcutTitle(title: string): string {
  return title === "Full shape stays visible" ? title : `${title} (V; Alt-click isolates branch)`;
}
