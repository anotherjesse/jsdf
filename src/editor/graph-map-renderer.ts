import type { Node } from "../core/nodes";
import type { GraphModel, GraphNodeView } from "./graph-model";
import {
  effectiveVisibleGraphNodeIds,
  graphNodePath,
  graphVisibilityMeta,
  graphVisibilityStateForPath,
} from "./graph-visibility";

export interface GraphMapRenderOptions {
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
  onSelect(node: Node): void;
  onToggleVisibility(node: Node, options?: { focus?: boolean; isolate?: boolean }): void;
  onKeyDown(event: KeyboardEvent, node: Node): void;
  attachSoloHover(target: Element, path: Node[]): void;
}

export function renderGraphMap(options: GraphMapRenderOptions): void {
  const nodes = options.model.nodes.filter((view) => options.model.visibleNodeIds.has(view.node.id));
  if (nodes.length === 0) {
    options.container.textContent = "";
    return;
  }

  const levels = new Map<number, GraphNodeView[]>();
  for (const view of nodes) {
    const level = levels.get(view.depth) ?? [];
    level.push(view);
    levels.set(view.depth, level);
  }
  for (const level of levels.values()) level.sort((a, b) => a.node.id - b.node.id);

  const maxRows = Math.max(...[...levels.values()].map((level) => level.length), 1);
  const width = Math.max(390, 80 + (options.model.maxDepth + 1) * 112);
  const height = Math.max(148, 42 + maxRows * 34);
  const xSpan = width - 64;
  const ySpan = height - 40;
  const positions = new Map<number, { x: number; y: number }>();
  for (const [depth, level] of levels) {
    const x = 32 + (options.model.maxDepth === 0 ? 0 : xSpan * (depth / options.model.maxDepth));
    level.forEach((view, index) => {
      const y = 20 + (level.length === 1 ? ySpan / 2 : ySpan * (index / (level.length - 1)));
      positions.set(view.node.id, { x, y });
    });
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "SDF graph");
  options.container.style.setProperty("--graph-map-height", `${height}px`);
  options.container.style.setProperty("--graph-map-width", `${width}px`);

  const effectiveVisibleNodeIds = effectiveVisibleGraphNodeIds(options.root, options.hiddenNodeIds);

  for (const edge of options.model.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.classList.add("graph-edge");
    if (options.selectedNodeId != null && (edge.from === options.selectedNodeId || edge.to === options.selectedNodeId)) {
      line.classList.add("selected");
    }
    svg.append(line);
  }

  for (const view of nodes) {
    const position = positions.get(view.node.id);
    if (!position) continue;
    svg.append(renderMapNode(view, position.x, position.y, effectiveVisibleNodeIds, options));
  }

  options.container.replaceChildren(svg);
}

function renderMapNode(
  view: GraphNodeView,
  x: number,
  y: number,
  effectiveVisibleNodeIds: ReadonlySet<number>,
  options: GraphMapRenderOptions,
): SVGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("graph-map-node");
  if (options.selectedNodeId === view.node.id) group.classList.add("selected");
  if (options.hoveredNodeId === view.node.id) group.classList.add("hovered");
  if (options.focusHoverNodeId === view.node.id) group.classList.add("focus-peek");
  if (options.lockedSoloNodeId === view.node.id) group.classList.add("isolated");
  if (options.dirtyNodeIds.has(view.node.id)) group.classList.add("edited");
  const directlyHidden = options.hiddenNodeIds.has(view.node.id);
  const inheritedHidden = !directlyHidden && !effectiveVisibleNodeIds.has(view.node.id);
  if (directlyHidden) group.classList.add("hidden-node");
  if (inheritedHidden) group.classList.add("inherited-hidden");
  if (options.filter && view.matched) group.classList.add("matched");
  if (view.parents.size > 1) group.classList.add("shared");
  group.dataset.nodeId = String(view.node.id);
  group.setAttribute("role", "button");
  group.setAttribute("tabindex", "0");
  group.setAttribute("aria-label", `${view.node.kind} #${view.node.id}`);
  group.setAttribute("aria-keyshortcuts", options.nodeKeyboardShortcuts(view.node));

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x - 50));
  rect.setAttribute("y", String(y - 12));
  rect.setAttribute("width", "100");
  rect.setAttribute("height", "24");
  rect.setAttribute("rx", "6");
  rect.classList.add("graph-map-card");

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(x + 9));
  text.setAttribute("y", String(y + 4));
  text.textContent = mapLabel(view.node.kind);

  const path = graphNodePath(options.root, view.node.id);
  const { isRoot } = graphVisibilityStateForPath(options.root, options.hiddenNodeIds, view.node, path);
  const visibilityMeta = graphVisibilityMeta(isRoot, directlyHidden, inheritedHidden);
  group.append(rect, renderMapEye(view.node, x - 34, y, visibilityMeta, options), text);
  group.addEventListener("click", () => options.onSelect(view.node));
  options.attachSoloHover(group, path);
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      options.onSelect(view.node);
      return;
    }
    options.onKeyDown(event, view.node);
  });
  return group;
}

function renderMapEye(
  node: Node,
  x: number,
  y: number,
  visibilityMeta: ReturnType<typeof graphVisibilityMeta>,
  options: GraphMapRenderOptions,
): SVGElement {
  const eye = document.createElementNS("http://www.w3.org/2000/svg", "g");
  eye.classList.add("graph-map-eye");
  eye.dataset.state = visibilityMeta.state;
  if (!visibilityMeta.disabled) {
    eye.setAttribute("role", "button");
    eye.setAttribute("tabindex", "0");
  }
  eye.setAttribute("aria-label", `${visibilityShortcutTitle(visibilityMeta.title)} ${node.kind} #${node.id}`);
  eye.setAttribute("aria-keyshortcuts", "V");
  eye.setAttribute("aria-pressed", String(visibilityMeta.pressed));

  const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  hitArea.setAttribute("x", String(x - 11));
  hitArea.setAttribute("y", String(y - 11));
  hitArea.setAttribute("width", "22");
  hitArea.setAttribute("height", "22");
  hitArea.setAttribute("rx", "5");
  hitArea.classList.add("graph-map-eye-hit");

  const outline = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  outline.setAttribute("cx", String(x));
  outline.setAttribute("cy", String(y));
  outline.setAttribute("rx", "7.4");
  outline.setAttribute("ry", "4.8");
  outline.classList.add("graph-map-eye-outline");

  const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  pupil.setAttribute("cx", String(x));
  pupil.setAttribute("cy", String(y));
  pupil.setAttribute("r", visibilityMeta.state === "hidden" ? "1.7" : "2.4");
  pupil.classList.add("graph-map-eye-pupil");

  const slash = document.createElementNS("http://www.w3.org/2000/svg", "line");
  slash.setAttribute("x1", String(x - 7.6));
  slash.setAttribute("y1", String(y + 5.7));
  slash.setAttribute("x2", String(x + 7.6));
  slash.setAttribute("y2", String(y - 5.7));
  slash.classList.add("graph-map-eye-slash");

  eye.append(hitArea, outline, pupil, slash);
  if (!visibilityMeta.disabled) {
    eye.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onToggleVisibility(node, { isolate: event.altKey });
    });
    eye.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      options.onToggleVisibility(node, { focus: true });
    });
  }
  return eye;
}

function mapLabel(kind: string): string {
  return kind.length > 10 ? `${kind.slice(0, 9)}...` : kind;
}

function visibilityShortcutTitle(title: string): string {
  return title === "Full shape stays visible" ? title : `${title} (V; Alt-click isolates branch)`;
}
