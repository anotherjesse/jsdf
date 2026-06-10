import type { Node, SDF3 } from "../core/nodes";
import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import type { GraphSourceLink } from "./clean-source-patch";
import { buildGraphModel, childMatchesFilter, type GraphModel, type GraphNodeView } from "./graph-model";
import { graphVisibilityMeta, renderEyeIcon } from "./graph-visibility";
import { isCountParamLabel, isNonNegativeParamLabel, scrubNumericParamValue } from "./scrub-values";
import { buildSoloPreview, type SoloPreview } from "./solo-preview";

export type ParamPath = Array<string | number>;
export type ParamValue = unknown;

export interface GraphParamEdit {
  node: Node;
  nodeId: number;
  nodeKind: string;
  path: ParamPath;
  label: string;
  previousValue: ParamValue;
  nextValue: ParamValue;
  editSessionId?: string;
}

export interface GraphDirtyParam {
  nodeId: number;
  path: ParamPath;
}

export interface GraphInspectorOptions {
  onSelect(node: Node | null): void;
  onHover(node: Node | null, options: GraphHoverOptions): void;
  onEdit(edit: GraphParamEdit): void;
  onSolo(preview: SoloPreview | null): void;
  onRevealSource(link: GraphSourceLink): void;
  onSourceHover(link: GraphSourceLink | null): void;
  onVisibilityChange(hiddenNodeIds: readonly number[]): void;
}

export interface GraphHoverOptions {
  shiftKey: boolean;
}

export class GraphInspector {
  private sdf: SDF3 | null = null;
  private selected: Node | null = null;
  private hovered: Node | null = null;
  private filter = "";
  private showMap = false;
  private sourceLinks: readonly GraphSourceLink[] = [];
  private hoveredSourceLink: GraphSourceLink | null = null;
  private selectedSourceLink: GraphSourceLink | null = null;
  private hoverSoloKey: string | null = null;
  private lockedSoloKey: string | null = null;
  private lockedSoloNodeId: number | null = null;
  private revealSelectedAfterRender = false;
  private focusSelectedAfterRender = false;
  private readonly hiddenNodeIds = new Set<number>();
  private readonly customMatrixNodeIds = new Set<number>();
  private readonly dirtyNodeIds = new Set<number>();
  private readonly dirtyParamKeys = new Set<string>();
  private readonly toolbar = document.createElement("div");
  private readonly filterInput = document.createElement("input");
  private readonly previousMatchButton = document.createElement("button");
  private readonly nextMatchButton = document.createElement("button");
  private readonly mapButton = document.createElement("button");
  private readonly showAllButton = document.createElement("button");
  private readonly showAllCount = document.createElement("span");
  private readonly summary = document.createElement("span");
  private readonly map = document.createElement("div");
  private readonly tree = document.createElement("div");
  private readonly params = document.createElement("div");

  constructor(
    private readonly root: HTMLElement,
    private readonly options: GraphInspectorOptions,
  ) {
    root.replaceChildren();
    this.toolbar.className = "graph-toolbar";
    this.filterInput.type = "search";
    this.filterInput.placeholder = "Filter";
    this.filterInput.setAttribute("aria-label", "Filter graph nodes");
    this.previousMatchButton.type = "button";
    this.previousMatchButton.className = "graph-match-nav";
    this.previousMatchButton.textContent = "Prev";
    this.previousMatchButton.title = "Previous matching node";
    this.previousMatchButton.setAttribute("aria-label", "Previous matching graph node");
    this.previousMatchButton.hidden = true;
    this.nextMatchButton.type = "button";
    this.nextMatchButton.className = "graph-match-nav";
    this.nextMatchButton.textContent = "Next";
    this.nextMatchButton.title = "Next matching node";
    this.nextMatchButton.setAttribute("aria-label", "Next matching graph node");
    this.nextMatchButton.hidden = true;
    this.mapButton.type = "button";
    this.mapButton.className = "graph-map-toggle";
    this.mapButton.textContent = "Map";
    this.mapButton.title = "Toggle graph map";
    this.mapButton.setAttribute("aria-label", "Toggle graph map");
    this.mapButton.setAttribute("aria-pressed", "false");
    this.showAllButton.type = "button";
    this.showAllButton.className = "graph-show-all";
    this.showAllButton.title = "Show all hidden nodes (Shift+V)";
    this.showAllButton.setAttribute("aria-label", "Show all hidden graph nodes");
    this.showAllButton.hidden = true;
    this.showAllCount.className = "visibility-count";
    this.showAllCount.setAttribute("aria-hidden", "true");
    this.showAllButton.append(renderEyeIcon("visible"), this.showAllCount);
    this.summary.className = "graph-summary";
    this.filterInput.addEventListener("input", () => {
      this.filter = this.filterInput.value;
      this.render();
    });
    this.filterInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.selectFilterMatch(event.shiftKey ? -1 : 1);
      }
      if (event.key === "Escape" && this.filter) {
        event.preventDefault();
        this.filter = "";
        this.filterInput.value = "";
        this.render();
      }
    });
    this.previousMatchButton.addEventListener("click", () => this.selectFilterMatch(-1));
    this.nextMatchButton.addEventListener("click", () => this.selectFilterMatch(1));
    this.mapButton.addEventListener("click", () => {
      this.showMap = !this.showMap;
      this.mapButton.setAttribute("aria-pressed", String(this.showMap));
      this.render();
    });
    this.showAllButton.addEventListener("click", () => this.showAllNodes());
    window.addEventListener("pointermove", (event) => {
      if (!(event.target instanceof globalThis.Node) || !this.root.contains(event.target)) {
        this.clearHover();
      }
      if (!event.shiftKey) this.clearSolo();
    }, { capture: true });
    window.addEventListener("pointerup", () => this.clearSolo(), { capture: true });
    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") this.clearSolo();
    });
    window.addEventListener("blur", () => this.clearSolo());
    root.addEventListener("pointerleave", () => {
      this.clearHover();
      this.clearSolo();
    });
    this.toolbar.append(
      this.filterInput,
      this.previousMatchButton,
      this.nextMatchButton,
      this.mapButton,
      this.showAllButton,
      this.summary,
    );
    this.map.className = "graph-map";
    this.tree.className = "graph-tree";
    this.params.className = "param-editor";
    root.append(this.toolbar, this.map, this.tree, this.params);
  }

  setSdf(sdf: SDF3, hiddenNodeIds: readonly number[] = []): void {
    this.sdf = sdf;
    this.selected = sdf.node;
    this.hoveredSourceLink = null;
    this.selectedSourceLink = null;
    this.hoverSoloKey = null;
    this.lockedSoloKey = null;
    this.lockedSoloNodeId = null;
    this.hiddenNodeIds.clear();
    for (const nodeId of hiddenNodeIds) {
      if (nodeId !== sdf.node.id) this.hiddenNodeIds.add(nodeId);
    }
    this.render();
    this.options.onSelect(this.selected);
  }

  setSelected(node: Node | null): void {
    this.clearLockedSoloIfDifferent(node);
    this.selected = node;
    this.revealSelectedAfterRender = node != null;
    this.render();
  }

  setHoveredNodeById(id: number | null): Node | null {
    if (id == null || !this.sdf) {
      if (this.hovered) {
        this.hovered = null;
        this.render();
      }
      return null;
    }
    const node = findNode(this.sdf.node, id);
    if (this.hovered?.id === node?.id) return node;
    this.hovered = node;
    this.render();
    return node;
  }

  setSourceLinks(links: readonly GraphSourceLink[]): void {
    this.sourceLinks = [...links];
    if (this.hoveredSourceLink && !this.sourceLinks.some((link) => sourceLinksEqual(link, this.hoveredSourceLink))) {
      this.hoveredSourceLink = null;
    }
    if (this.selectedSourceLink && !this.sourceLinks.some((link) => sourceLinksEqual(link, this.selectedSourceLink))) {
      this.selectedSourceLink = null;
    }
    this.render();
  }

  setSelectedSourceLink(link: GraphSourceLink | null): void {
    if (sourceLinksEqual(this.selectedSourceLink, link)) return;
    this.selectedSourceLink = link;
    this.render();
  }

  setHoveredSourceLink(link: GraphSourceLink | null): void {
    if (sourceLinksEqual(this.hoveredSourceLink, link)) return;
    this.hoveredSourceLink = link;
    this.render();
  }

  setDirtyParams(params: readonly GraphDirtyParam[]): void {
    this.dirtyNodeIds.clear();
    this.dirtyParamKeys.clear();
    for (const param of params) {
      this.dirtyNodeIds.add(param.nodeId);
      this.dirtyParamKeys.add(paramKey(param.nodeId, param.path));
    }
    this.render();
  }

  selectNodeById(id: number): Node | null {
    if (!this.sdf) return null;
    const node = findNode(this.sdf.node, id);
    if (!node) return null;
    this.select(node);
    return node;
  }

  buildSoloPreviewForNodeId(id: number): SoloPreview | null {
    return buildSoloPreview(this.pathToNode(id));
  }

  getSelected(): Node | null {
    return this.selected;
  }

  getParamValue(nodeId: number, path: ParamPath): ParamValue | undefined {
    if (!this.sdf) return undefined;
    const node = findNode(this.sdf.node, nodeId);
    return node ? getAtPath(node.params, path) : undefined;
  }

  setParamValue(nodeId: number, path: ParamPath, value: ParamValue): Node | null {
    if (!this.sdf) return null;
    const node = findNode(this.sdf.node, nodeId);
    if (!node) return null;
    this.clearLockedSoloIfDifferent(node);
    setAtPath(node.params, path, value);
    this.selected = node;
    this.revealSelectedAfterRender = true;
    this.render();
    this.options.onSelect(node);
    return node;
  }

  private render(): void {
    this.map.replaceChildren();
    this.tree.replaceChildren();
    this.params.replaceChildren();
    if (!this.sdf) return;
    const model = buildGraphModel(this.sdf.node, this.filter);
    this.renderSummary(model);
    this.updateMatchNavigation(model);
    this.renderShowAllControl();
    this.map.hidden = !this.showMap;
    if (this.showMap) this.renderMap(model);
    if (model.visibleNodeIds.size === 0) {
      const empty = document.createElement("div");
      empty.className = "param-empty graph-empty";
      empty.textContent = "No matching nodes";
      this.tree.append(empty);
    } else {
      this.tree.append(this.renderTreeHeader(), this.renderNode(this.sdf.node, 0, model, [this.sdf.node]));
    }
    this.renderParams();
    this.revealSelectedNode();
  }

  private renderShowAllControl(): void {
    const hidden = this.hiddenNodeIds.size;
    this.showAllButton.hidden = hidden === 0;
    this.showAllCount.textContent = hidden > 99 ? "99+" : String(hidden);
    const label = hidden === 1 ? "Show 1 hidden node" : `Show ${hidden} hidden nodes`;
    this.showAllButton.title = `${label} (Shift+V)`;
    this.showAllButton.setAttribute("aria-label", label);
  }

  private renderTreeHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "graph-tree-header";

    const visibility = document.createElement("div");
    visibility.className = "graph-tree-header-eye";
    visibility.title = "Visibility";
    visibility.setAttribute("aria-label", "Visibility column");
    visibility.append(renderEyeIcon("visible"));

    const rule = document.createElement("div");
    rule.className = "graph-tree-header-rule";
    rule.setAttribute("aria-hidden", "true");

    header.append(visibility, rule);
    return header;
  }

  private renderNode(node: Node, depth: number, model: GraphModel, path: Node[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "graph-node-group";
    const view = model.nodeById.get(node.id);

    const row = document.createElement("div");
    row.className = "graph-node-row";
    row.style.setProperty("--depth", String(depth));

    const { isRoot, directlyHidden, inheritedHidden } = this.visibilityStateForPath(node, path);
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
    visibility.setAttribute("aria-pressed", String(visibilityMeta.pressed));
    visibility.append(renderEyeIcon(visibilityMeta.state));
    visibility.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleNodeVisibility(node);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-node";
    if (effectivelyHidden) button.classList.add("hidden-node");
    if (inheritedHidden && !directlyHidden) button.classList.add("inherited-hidden");
    if (this.filter && view?.matched) button.classList.add("matched");
    if (this.hovered?.id === node.id) button.classList.add("hovered");
    if (this.lockedSoloNodeId === node.id) button.classList.add("isolated");
    if (this.dirtyNodeIds.has(node.id)) button.classList.add("edited");
    button.setAttribute("aria-pressed", String(this.selected?.id === node.id));
    button.dataset.nodeId = String(node.id);
    const label = document.createElement("span");
    label.textContent = node.kind;
    const meta = document.createElement("small");
    const shared = (view?.parents.size ?? 0) > 1;
    meta.textContent = `#${node.id} ${node.dim}D${shared ? " shared" : ""}${this.dirtyNodeIds.has(node.id) ? " edited" : ""}${directlyHidden ? " hidden" : inheritedHidden ? " parent hidden" : ""}`;
    button.append(label, meta);
    button.addEventListener("click", () => this.select(node));
    button.addEventListener("keydown", (event) => this.handleNodeKeyDown(event, node));
    this.attachSoloHover(row, path);
    row.append(visibility, button);
    group.append(row);

    node.children.forEach((child) => {
      if (childMatchesFilter(child.node, model.visibleNodeIds)) {
        group.append(this.renderNode(child.node, depth + 1, model, [...path, child.node]));
      }
    });
    return group;
  }

  private renderSummary(model: GraphModel): void {
    const total = model.nodes.length;
    const visible = model.visibleNodeIds.size;
    const matched = this.matchingNodes(model).length;
    const hidden = this.hiddenNodeIds.size;
    const suffix = hidden > 0 ? `, ${hidden} hidden` : "";
    this.summary.textContent = this.filter
      ? `${matched} ${matched === 1 ? "match" : "matches"}, ${visible}/${total} shown${suffix}`
      : `${total} nodes, ${model.edges.length} edges${suffix}`;
  }

  private updateMatchNavigation(model: GraphModel): void {
    const show = this.filter.trim() !== "" && this.matchingNodes(model).length > 0;
    const enabled = show && this.matchingNodes(model).length > 1;
    this.previousMatchButton.hidden = !show;
    this.nextMatchButton.hidden = !show;
    this.previousMatchButton.disabled = !enabled;
    this.nextMatchButton.disabled = !enabled;
  }

  private selectFilterMatch(direction: 1 | -1): void {
    if (!this.sdf || this.filter.trim() === "") return;
    const matches = this.matchingNodes(buildGraphModel(this.sdf.node, this.filter));
    if (matches.length === 0) return;
    const currentIndex = this.selected ? matches.findIndex((view) => view.node.id === this.selected?.id) : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : matches.length - 1
      : (currentIndex + direction + matches.length) % matches.length;
    this.select(matches[nextIndex].node);
  }

  private matchingNodes(model: GraphModel): GraphNodeView[] {
    return model.nodes.filter((view) => view.matched);
  }

  private renderMap(model: GraphModel): void {
    const nodes = model.nodes.filter((view) => model.visibleNodeIds.has(view.node.id));
    if (nodes.length === 0) {
      this.map.textContent = "";
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
    const width = Math.max(390, 80 + (model.maxDepth + 1) * 112);
    const height = Math.max(148, 42 + maxRows * 34);
    const xSpan = width - 64;
    const ySpan = height - 40;
    const positions = new Map<number, { x: number; y: number }>();
    for (const [depth, level] of levels) {
      const x = 32 + (model.maxDepth === 0 ? 0 : xSpan * (depth / model.maxDepth));
      level.forEach((view, index) => {
        const y = 20 + (level.length === 1 ? ySpan / 2 : ySpan * (index / (level.length - 1)));
        positions.set(view.node.id, { x, y });
      });
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "SDF graph");
    this.map.style.setProperty("--graph-map-height", `${height}px`);
    this.map.style.setProperty("--graph-map-width", `${width}px`);

    const effectiveVisibleNodeIds = this.effectiveVisibleNodeIds();

    for (const edge of model.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
      line.classList.add("graph-edge");
      if (this.selected && (edge.from === this.selected.id || edge.to === this.selected.id)) {
        line.classList.add("selected");
      }
      svg.append(line);
    }

    for (const view of nodes) {
      const position = positions.get(view.node.id);
      if (!position) continue;
      svg.append(this.renderMapNode(view, position.x, position.y, effectiveVisibleNodeIds));
    }

    this.map.replaceChildren(svg);
  }

  private renderMapNode(view: GraphNodeView, x: number, y: number, effectiveVisibleNodeIds: ReadonlySet<number>): SVGElement {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("graph-map-node");
    if (this.selected?.id === view.node.id) group.classList.add("selected");
    if (this.hovered?.id === view.node.id) group.classList.add("hovered");
    if (this.lockedSoloNodeId === view.node.id) group.classList.add("isolated");
    if (this.dirtyNodeIds.has(view.node.id)) group.classList.add("edited");
    const directlyHidden = this.hiddenNodeIds.has(view.node.id);
    const inheritedHidden = !directlyHidden && !effectiveVisibleNodeIds.has(view.node.id);
    if (directlyHidden) group.classList.add("hidden-node");
    if (inheritedHidden) group.classList.add("inherited-hidden");
    if (this.filter && view.matched) group.classList.add("matched");
    if (view.parents.size > 1) group.classList.add("shared");
    group.dataset.nodeId = String(view.node.id);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${view.node.kind} #${view.node.id}`);

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

    const path = this.pathToNode(view.node.id);
    const { isRoot } = this.visibilityStateForPath(view.node, path);
    const visibilityMeta = graphVisibilityMeta(isRoot, directlyHidden, inheritedHidden);
    group.append(rect, this.renderMapEye(view.node, x - 34, y, visibilityMeta), text);
    group.addEventListener("click", () => this.select(view.node));
    this.attachSoloHover(group, path);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.select(view.node);
        return;
      }
      this.handleNodeKeyDown(event, view.node);
    });
    return group;
  }

  private renderMapEye(
    node: Node,
    x: number,
    y: number,
    visibilityMeta: ReturnType<typeof graphVisibilityMeta>,
  ): SVGElement {
    const eye = document.createElementNS("http://www.w3.org/2000/svg", "g");
    eye.classList.add("graph-map-eye");
    eye.dataset.state = visibilityMeta.state;
    if (!visibilityMeta.disabled) {
      eye.setAttribute("role", "button");
      eye.setAttribute("tabindex", "0");
    }
    eye.setAttribute("aria-label", `${visibilityShortcutTitle(visibilityMeta.title)} ${node.kind} #${node.id}`);
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
        this.toggleNodeVisibility(node);
      });
      eye.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.toggleNodeVisibility(node, { focus: true });
      });
    }
    return eye;
  }

  private toggleNodeVisibility(node: Node, options: { focus?: boolean } = {}): void {
    if (this.hiddenNodeIds.has(node.id)) {
      this.hiddenNodeIds.delete(node.id);
    } else {
      this.hiddenNodeIds.add(node.id);
    }
    if (options.focus) {
      this.selected = node;
      this.revealSelectedAfterRender = true;
      this.focusSelectedAfterRender = true;
    }
    this.render();
    this.options.onVisibilityChange([...this.hiddenNodeIds]);
  }

  private showAllNodes(options: { focus?: boolean } = {}): void {
    if (this.hiddenNodeIds.size === 0) return;
    this.hiddenNodeIds.clear();
    if (options.focus && this.selected) {
      this.revealSelectedAfterRender = true;
      this.focusSelectedAfterRender = true;
    }
    this.render();
    this.options.onVisibilityChange([]);
  }

  private effectiveVisibleNodeIds(): Set<number> {
    const out = new Set<number>();
    if (!this.sdf) return out;

    const visit = (node: Node) => {
      if (this.hiddenNodeIds.has(node.id)) return;
      out.add(node.id);
      for (const child of node.children) visit(child.node);
    };
    visit(this.sdf.node);
    return out;
  }

  private select(node: Node, options: { focus?: boolean } = {}): void {
    this.clearLockedSoloIfDifferent(node);
    this.selected = node;
    this.revealSelectedAfterRender = true;
    this.focusSelectedAfterRender = Boolean(options.focus);
    this.render();
    this.options.onSelect(node);
  }

  private revealSelectedNode(): void {
    if (!this.revealSelectedAfterRender || !this.selected) return;
    this.revealSelectedAfterRender = false;
    const focus = this.focusSelectedAfterRender;
    this.focusSelectedAfterRender = false;
    const target = this.tree.querySelector<HTMLElement>(`[data-node-id="${this.selected.id}"]`);
    window.requestAnimationFrame(() => {
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focus) target?.focus({ preventScroll: true });
    });
  }

  private handleNodeKeyDown(event: KeyboardEvent, node: Node): void {
    if (this.handleNodeActionKey(event, node)) return;
    const target = this.nodeForKeyboardNavigation(event.key, node);
    if (!target) return;
    event.preventDefault();
    this.select(target, { focus: true });
  }

  private handleNodeActionKey(event: KeyboardEvent, node: Node): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === "v") {
      event.preventDefault();
      if (event.shiftKey) {
        this.showAllNodes({ focus: true });
      } else if (this.sdf?.node.id !== node.id) {
        this.toggleNodeVisibility(node, { focus: true });
      }
      return true;
    }

    if (key === "i") {
      event.preventDefault();
      this.toggleLockedSolo(node, { focus: true });
      return true;
    }

    if (key === "c") {
      const link = this.sourceLinkForNode(node.id);
      if (!link) return false;
      event.preventDefault();
      this.options.onRevealSource(link);
      return true;
    }

    return false;
  }

  private nodeForKeyboardNavigation(key: string, node: Node): Node | null {
    if (!this.sdf) return null;
    if (key === "ArrowLeft") return this.parentNode(node);
    if (key === "ArrowRight") return this.firstVisibleChild(node);

    const nodes = this.visibleTreeNodes();
    const currentIndex = nodes.findIndex((candidate) => candidate.id === node.id);
    if (currentIndex < 0) return null;

    if (key === "ArrowUp") return nodes[Math.max(0, currentIndex - 1)] ?? null;
    if (key === "ArrowDown") return nodes[Math.min(nodes.length - 1, currentIndex + 1)] ?? null;
    if (key === "Home") return nodes[0] ?? null;
    if (key === "End") return nodes.at(-1) ?? null;
    return null;
  }

  private visibleTreeNodes(): Node[] {
    if (!this.sdf) return [];
    const model = buildGraphModel(this.sdf.node, this.filter);
    const out: Node[] = [];

    const visit = (node: Node) => {
      if (!childMatchesFilter(node, model.visibleNodeIds)) return;
      out.push(node);
      for (const child of node.children) visit(child.node);
    };

    visit(this.sdf.node);
    return out;
  }

  private parentNode(node: Node): Node | null {
    const path = this.pathToNode(node.id);
    return path.length > 1 ? path[path.length - 2] : null;
  }

  private firstVisibleChild(node: Node): Node | null {
    if (!this.sdf) return null;
    const model = buildGraphModel(this.sdf.node, this.filter);
    return node.children.find((child) => childMatchesFilter(child.node, model.visibleNodeIds))?.node ?? null;
  }

  private attachSoloHover(target: Element, path: Node[]): void {
    const sourceLink = this.sourceLinkForNode(path.at(-1)?.id ?? -1);
    target.addEventListener("pointerenter", (event) => {
      this.updateHover(path, event);
      if (sourceLink) this.options.onSourceHover(sourceLink);
    });
    target.addEventListener("pointermove", (event) => this.updateHover(path, event));
    target.addEventListener("pointerleave", (event) => {
      if (sourceLink && !containsEventTarget(target, relatedEventTarget(event))) {
        this.options.onSourceHover(null);
      }
      this.clearHover();
      this.clearSolo();
    });
    target.addEventListener("focusin", (event) => {
      this.updateHover(path, event);
      if (sourceLink) this.options.onSourceHover(sourceLink);
    });
    target.addEventListener("focusout", (event) => {
      if (sourceLink && !containsEventTarget(target, relatedEventTarget(event))) {
        this.options.onSourceHover(null);
      }
      if (!containsEventTarget(target, relatedEventTarget(event))) {
        this.clearHover();
        this.clearSolo();
      }
    });
  }

  private updateHover(path: Node[], event: Event): void {
    const target = path.at(-1) ?? null;
    this.setHoveredNodeById(target?.id ?? null);
    this.options.onHover(target, { shiftKey: event instanceof PointerEvent && event.shiftKey });
  }

  private updateSolo(path: Node[], event: Event): void {
    if (this.lockedSoloKey) return;
    if (!(event instanceof PointerEvent) || !event.shiftKey) {
      this.clearSolo();
      return;
    }
    const preview = buildSoloPreview(path);
    if (!preview) {
      this.clearSolo();
      return;
    }
    if (preview.key === this.hoverSoloKey) return;
    this.hoverSoloKey = preview.key;
    this.options.onSolo(preview);
  }

  private clearHover(): void {
    this.setHoveredNodeById(null);
    this.options.onHover(null, { shiftKey: false });
  }

  private clearSolo(): void {
    if (!this.hoverSoloKey) return;
    this.hoverSoloKey = null;
    if (this.lockedSoloKey) return;
    this.options.onSolo(null);
  }

  private toggleLockedSolo(node: Node, options: { focus?: boolean } = {}): void {
    const preview = this.soloPreviewForNode(node);
    if (!preview) return;

    this.hoverSoloKey = null;
    if (this.lockedSoloKey === preview.key) {
      this.lockedSoloKey = null;
      this.lockedSoloNodeId = null;
      this.options.onSolo(null);
    } else {
      this.lockedSoloKey = preview.key;
      this.lockedSoloNodeId = node.id;
      this.options.onSolo(preview);
    }
    if (options.focus) {
      this.selected = node;
      this.revealSelectedAfterRender = true;
      this.focusSelectedAfterRender = true;
    }
    this.render();
  }

  private clearLockedSoloIfDifferent(node: Node | null): void {
    if (!this.lockedSoloKey) return;
    const preview = node ? this.soloPreviewForNode(node) : null;
    if (preview?.key === this.lockedSoloKey) return;
    this.lockedSoloKey = null;
    this.lockedSoloNodeId = null;
    this.hoverSoloKey = null;
    this.options.onSolo(null);
  }

  private soloPreviewForNode(node: Node): SoloPreview | null {
    return buildSoloPreview(this.pathToNode(node.id));
  }

  private pathToNode(id: number): Node[] {
    if (!this.sdf) return [];
    const path: Node[] = [];
    const visit = (node: Node): boolean => {
      path.push(node);
      if (node.id === id) return true;
      for (const child of node.children) {
        if (visit(child.node)) return true;
      }
      path.pop();
      return false;
    };
    visit(this.sdf.node);
    return path;
  }

  private renderParams(): void {
    const node = this.selected;
    if (!node) {
      this.params.textContent = "";
      return;
    }

    const title = document.createElement("div");
    title.className = "param-title";
    if (this.dirtyNodeIds.has(node.id)) title.classList.add("edited");
    if (this.sourceLinkMatchesNode(this.selectedSourceLink, node.id)) title.classList.add("source-selected");
    const titleText = document.createElement("div");
    titleText.className = "param-title-text";
    const kind = document.createElement("strong");
    kind.textContent = node.kind;
    const id = document.createElement("span");
    id.textContent = `#${node.id}`;
    titleText.append(kind, id);
    title.append(titleText);

    const actions = document.createElement("div");
    actions.className = "param-title-actions";

    const path = this.pathToNode(node.id);
    const { isRoot, directlyHidden, inheritedHidden } = this.visibilityStateForPath(node, path);
    const visibilityMeta = graphVisibilityMeta(isRoot, directlyHidden, inheritedHidden);
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "graph-visibility param-visibility";
    visibility.disabled = visibilityMeta.disabled;
    visibility.dataset.state = visibilityMeta.state;
    if (inheritedHidden && !directlyHidden) visibility.classList.add("inherited-hidden");
    visibility.title = visibilityShortcutTitle(visibilityMeta.title);
    visibility.setAttribute("aria-label", `${visibility.title} selected ${node.kind} #${node.id}`);
    visibility.setAttribute("aria-pressed", String(visibilityMeta.pressed));
    visibility.append(renderEyeIcon(visibilityMeta.state));
    visibility.addEventListener("click", () => this.toggleNodeVisibility(node));
    actions.append(visibility);

    const nodeSourceLink = this.sourceLinkForNode(node.id);
    if (nodeSourceLink) {
      const source = renderCodeLinkButton(`Reveal ${node.kind} #${node.id} in code (C)`, "param-title-button param-code-link");
      source.addEventListener("click", () => this.options.onRevealSource(nodeSourceLink));
      actions.append(source);
    }

    const soloPreview = this.soloPreviewForNode(node);
    if (soloPreview) {
      const isolate = document.createElement("button");
      isolate.type = "button";
      isolate.className = "param-title-button param-isolate";
      isolate.textContent = "Isolate";
      isolate.title = "Isolate selected node in preview (I)";
      isolate.setAttribute("aria-label", "Isolate selected node in preview");
      isolate.setAttribute("aria-pressed", String(node.id === this.lockedSoloNodeId));
      isolate.addEventListener("click", () => this.toggleLockedSolo(node));
      actions.append(isolate);
    }
    if (actions.childElementCount > 0) title.append(actions);
    this.params.append(title);

    const breadcrumb = this.renderBreadcrumb(node);
    if (breadcrumb) this.params.append(breadcrumb);

    const orientationControl = this.renderOrientationControl(node);
    if (orientationControl) this.params.append(orientationControl);

    const fields = collectNumericParams(node.params)
      .filter((field) => orientationControl == null || this.shouldShowMatrixFields(node, field));
    if (fields.length === 0 && !orientationControl) {
      const empty = document.createElement("div");
      empty.className = "param-empty";
      empty.textContent = "No numeric params";
      this.params.append(empty);
      return;
    }

    for (const field of fields) {
      this.params.append(this.renderNumberField(node, field));
    }
  }

  private renderBreadcrumb(node: Node): HTMLElement | null {
    const path = this.pathToNode(node.id);
    if (path.length <= 1) return null;

    const trail = document.createElement("div");
    trail.className = "param-breadcrumb";
    trail.setAttribute("aria-label", "Selected node path");

    path.forEach((crumb, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "param-breadcrumb-separator";
        separator.textContent = "/";
        trail.append(separator);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${crumb.kind} #${crumb.id}`;
      button.title = `${crumb.kind} #${crumb.id}`;
      this.attachSoloHover(button, path.slice(0, index + 1));
      if (crumb.id === node.id) {
        button.setAttribute("aria-current", "page");
      } else {
        button.addEventListener("click", () => this.select(crumb));
      }
      trail.append(button);
    });

    return trail;
  }

  private visibilityStateForPath(node: Node, path: readonly Node[]): { isRoot: boolean; directlyHidden: boolean; inheritedHidden: boolean } {
    const isRoot = this.sdf?.node.id === node.id;
    const directlyHidden = this.hiddenNodeIds.has(node.id);
    const inheritedHidden = path.slice(0, -1).some((ancestor) => this.hiddenNodeIds.has(ancestor.id));
    return { isRoot, directlyHidden, inheritedHidden };
  }

  private renderOrientationControl(node: Node): HTMLElement | null {
    if (node.kind !== "rotate3") return null;
    const matrix = matrixParam(node.params.matrix);
    if (!matrix) return null;

    const activeAxis = axisForMatrix(matrix);
    const showCustom = activeAxis === "custom" || this.customMatrixNodeIds.has(node.id);
    const group = document.createElement("div");
    group.className = "axis-control";
    if (this.dirtyParamKeys.has(paramKey(node.id, ["matrix"]))) group.classList.add("edited");
    if (this.sourceLinkMatchesParam(this.hoveredSourceLink, node.id, ["matrix"])) group.classList.add("source-hovered");
    if (this.sourceLinkMatchesParam(this.selectedSourceLink, node.id, ["matrix"])) group.classList.add("source-selected");
    this.attachSourceHover(group, this.sourceLinkForParam(node.id, ["matrix"]));

    const label = document.createElement("span");
    label.className = "axis-label";
    label.textContent = "Orient";

    const buttons = document.createElement("div");
    buttons.className = "axis-buttons";
    for (const axis of ORIENTATION_AXES) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = axis.toUpperCase();
      button.setAttribute("aria-label", `Orient ${axis.toUpperCase()}`);
      button.setAttribute("aria-pressed", String(!showCustom && activeAxis === axis));
      button.addEventListener("click", () => this.setOrientationAxis(node, matrix, axis));
      buttons.append(button);
    }

    const custom = document.createElement("button");
    custom.type = "button";
    custom.textContent = "Custom";
    custom.setAttribute("aria-label", "Show custom orientation matrix");
    custom.setAttribute("aria-pressed", String(showCustom));
    custom.addEventListener("click", () => {
      this.customMatrixNodeIds.add(node.id);
      this.render();
    });
    buttons.append(custom);

    group.append(label, buttons);
    return group;
  }

  private setOrientationAxis(node: Node, previous: number[][], axis: OrientationAxis): void {
    const nextValue = orientationMatrix(axis);
    if (matricesClose(previous, nextValue)) {
      this.customMatrixNodeIds.delete(node.id);
      this.render();
      return;
    }

    setAtPath(node.params, ["matrix"], cloneMatrix(nextValue));
    this.customMatrixNodeIds.delete(node.id);
    this.render();
    this.options.onEdit({
      node,
      nodeId: node.id,
      nodeKind: node.kind,
      path: ["matrix"],
      label: "axis",
      previousValue: cloneMatrix(previous),
      nextValue: cloneMatrix(nextValue),
    });
  }

  private shouldShowMatrixFields(node: Node, field: NumericParam): boolean {
    return node.kind !== "rotate3" || field.path[0] !== "matrix" || this.customMatrixNodeIds.has(node.id) || axisForMatrix(matrixParam(node.params.matrix)) === "custom";
  }

  private renderNumberField(node: Node, field: NumericParam): HTMLElement {
    const row = document.createElement("div");
    row.className = "param-row";
    if (this.dirtyParamKeys.has(paramKey(node.id, field.path))) row.classList.add("edited");
    if (this.sourceLinkMatchesParam(this.hoveredSourceLink, node.id, field.path)) row.classList.add("source-hovered");
    if (this.sourceLinkMatchesParam(this.selectedSourceLink, node.id, field.path)) row.classList.add("source-selected");

    const sourceLink = this.sourceLinkForParam(node.id, field.path);
    this.attachSourceHover(row, sourceLink);
    const nameGroup = document.createElement("span");
    nameGroup.className = "param-name-group";

    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = field.label;
    name.title = "Drag horizontally to scrub";
    name.setAttribute("aria-label", `${field.label} value`);
    nameGroup.append(name);

    if (sourceLink) {
      const source = renderCodeLinkButton(`Reveal ${field.label} in code`, "param-source-link");
      source.addEventListener("click", (event) => {
        event.preventDefault();
        this.options.onRevealSource(sourceLink);
      });
      nameGroup.append(source);
    }

    const input = document.createElement("input");
    input.type = "number";
    input.step = String(stepFor(field));
    input.value = formatValue(field.value);

    const range = document.createElement("input");
    range.type = "range";
    range.step = input.step;
    range.value = input.value;

    const recenterRange = (value: number) => {
      const bounds = rangeBoundsFor(field, value);
      range.min = formatValue(bounds.min);
      range.max = formatValue(bounds.max);
      range.value = formatValue(value);
    };
    recenterRange(field.value);

    let editSessionId: string | null = null;
    const beginEditSession = () => {
      editSessionId ??= nextEditSessionId("graph-param");
    };
    const endEditSession = () => {
      editSessionId = null;
    };

    const update = (
      value: number,
      options: { clampToRange?: boolean; recenterRange?: boolean; editSessionId?: string | null } = {},
    ) => {
      if (!Number.isFinite(value)) return;
      const nextValue = options.clampToRange
        ? clamp(value, Number(range.min), Number(range.max))
        : value;
      const previousValue = getAtPath(node.params, field.path);
      if (typeof previousValue !== "number") return;
      if (previousValue === nextValue) return;
      setAtPath(node.params, field.path, nextValue);
      input.value = formatValue(nextValue);
      if (options.recenterRange !== false) {
        recenterRange(nextValue);
      } else {
        range.value = formatValue(nextValue);
      }
      this.options.onEdit({
        node,
        nodeId: node.id,
        nodeKind: node.kind,
        path: [...field.path],
        label: field.label,
        previousValue,
        nextValue,
        ...(options.editSessionId ? { editSessionId: options.editSessionId } : {}),
      });
    };

    input.addEventListener("focus", beginEditSession);
    input.addEventListener("blur", endEditSession);
    input.addEventListener("input", () => update(Number(input.value), { editSessionId }));
    range.addEventListener("pointerdown", beginEditSession);
    range.addEventListener("pointerup", endEditSession);
    range.addEventListener("pointercancel", endEditSession);
    range.addEventListener("blur", endEditSession);
    range.addEventListener("change", endEditSession);
    range.addEventListener("input", () => update(Number(range.value), { recenterRange: false, editSessionId }));
    attachScrubber(
      name,
      input,
      field,
      (value) => update(value, { clampToRange: true, recenterRange: false, editSessionId }),
      () => {
        range.value = formatValue(Number(input.value));
        endEditSession();
      },
      beginEditSession,
    );

    row.append(nameGroup, input, range);
    return row;
  }

  private sourceLinkForParam(nodeId: number, path: ParamPath): GraphSourceLink | null {
    const exact = this.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.end > link.start && pathsEqual(link.path, path);
    });
    if (exact) return exact;
    return this.sourceLinks.find((link) => {
      return link.nodeId === nodeId
        && link.end > link.start
        && link.scrubbable === false
        && pathStartsWith(path, link.path);
    }) ?? null;
  }

  private sourceLinkMatchesParam(link: GraphSourceLink | null, nodeId: number, path: ParamPath): boolean {
    if (!link || link.nodeId !== nodeId || link.end <= link.start) return false;
    return pathsEqual(link.path, path) || (link.scrubbable === false && pathStartsWith(path, link.path));
  }

  private sourceLinkMatchesNode(link: GraphSourceLink | null, nodeId: number): boolean {
    return Boolean(link && link.nodeId === nodeId && link.label === "call" && link.end > link.start);
  }

  private sourceLinkForNode(nodeId: number): GraphSourceLink | null {
    return this.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.label === "call" && link.end > link.start;
    }) ?? this.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.end > link.start;
    }) ?? null;
  }

  private attachSourceHover(target: HTMLElement, link: GraphSourceLink | null): void {
    if (!link) return;
    target.addEventListener("pointerenter", () => {
      target.classList.add("source-hovered");
      this.options.onSourceHover(link);
    });
    target.addEventListener("pointerleave", () => {
      target.classList.remove("source-hovered");
      this.options.onSourceHover(null);
    });
    target.addEventListener("focusin", () => {
      target.classList.add("source-hovered");
      this.options.onSourceHover(link);
    });
    target.addEventListener("focusout", (event) => {
      if (event.relatedTarget instanceof globalThis.Node && target.contains(event.relatedTarget)) return;
      target.classList.remove("source-hovered");
      this.options.onSourceHover(null);
    });
  }
}

interface NumericParam {
  label: string;
  path: ParamPath;
  value: number;
}

interface NumericRange {
  min: number;
  max: number;
}

type OrientationAxis = "x" | "y" | "z";

const ORIENTATION_AXES: OrientationAxis[] = ["x", "y", "z"];

function collectNumericParams(params: Record<string, unknown>): NumericParam[] {
  const out: NumericParam[] = [];
  walkParams(params, [], out);
  return out;
}

function walkParams(value: unknown, path: ParamPath, out: NumericParam[]): void {
  if (typeof value === "number") {
    out.push({ label: formatPath(path), path: [...path], value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkParams(item, [...path, index], out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ease") continue;
      walkParams(item, [...path, key], out);
    }
  }
}

function setAtPath(root: Record<string, unknown>, path: ParamPath, value: ParamValue): void {
  let target: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const part = path[i];
    target = Array.isArray(target)
      ? target[part as number] as Record<string, unknown> | unknown[]
      : target[part as string] as Record<string, unknown> | unknown[];
  }
  const key = path[path.length - 1];
  if (Array.isArray(target)) {
    target[key as number] = value;
  } else {
    target[key as string] = value;
  }
}

function getAtPath(root: Record<string, unknown>, path: ParamPath): ParamValue {
  let target: unknown = root;
  for (const part of path) {
    target = Array.isArray(target)
      ? target[part as number]
      : (target as Record<string, unknown>)[part as string];
  }
  return target;
}

function pathsEqual(a: ParamPath, b: ParamPath): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function paramKey(nodeId: number, path: ParamPath): string {
  return `${nodeId}:${path.map(String).join("/")}`;
}

function pathStartsWith(path: ParamPath, prefix: ParamPath): boolean {
  return prefix.length > 0 && prefix.length < path.length && prefix.every((part, index) => part === path[index]);
}

function sourceLinksEqual(a: GraphSourceLink | null, b: GraphSourceLink | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.nodeId === b.nodeId
    && a.nodeKind === b.nodeKind
    && a.label === b.label
    && a.start === b.start
    && a.end === b.end
    && pathsEqual(a.path, b.path);
}

function matrixParam(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rows = value.map((row) => Array.isArray(row) ? row.map(Number) : []);
  if (!rows.every((row) => row.length === 3 && row.every(Number.isFinite))) return null;
  return rows;
}

function axisForMatrix(matrix: number[][] | null): OrientationAxis | "custom" {
  if (!matrix) return "custom";
  for (const axis of ORIENTATION_AXES) {
    if (matricesClose(matrix, orientationMatrix(axis))) return axis;
  }
  return "custom";
}

function orientationMatrix(axis: OrientationAxis): number[][] {
  const target = axis === "x" ? X : axis === "y" ? Y : Z;
  return rotateToMatrix(UP, target);
}

function matricesClose(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((row, rowIndex) => {
    return row.length === b[rowIndex].length && row.every((value, columnIndex) => {
      return Math.abs(value - b[rowIndex][columnIndex]) < 1e-9;
    });
  });
}

function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

function findNode(root: Node, id: number, visited = new Set<number>()): Node | null {
  if (root.id === id) return root;
  if (visited.has(root.id)) return null;
  visited.add(root.id);
  for (const child of root.children) {
    const match = findNode(child.node, id, visited);
    if (match) return match;
  }
  return null;
}

function formatPath(path: ParamPath): string {
  return path.map((part, index) => {
    if (typeof part === "number") return `[${part}]`;
    return index === 0 ? part : `.${part}`;
  }).join("");
}

function formatValue(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4).replace(/\.?0+$/, "");
}

function rangeBoundsFor(field: NumericParam, value: number): NumericRange {
  const label = field.label.toLowerCase();
  if (label.startsWith("matrix")) return { min: -1, max: 1 };

  if (isCountParam(label)) {
    const radius = Math.min(24, Math.max(4, Math.abs(value) * 0.5));
    return {
      min: Math.max(1, Math.floor(value - radius)),
      max: Math.max(2, Math.ceil(value + radius)),
    };
  }

  const radius = Math.min(4, Math.max(0.25, Math.abs(value) * 1.5));
  const min = isNonNegativeParam(label) ? Math.max(0, value - radius) : value - radius;
  return { min, max: value + radius };
}

function isCountParam(label: string): boolean {
  return isCountParamLabel(label);
}

function isNonNegativeParam(label: string): boolean {
  return isNonNegativeParamLabel(label);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stepFor(field: NumericParam): number {
  if (isCountParam(field.label.toLowerCase())) return 1;
  const size = Math.abs(field.value);
  if (size >= 10) return 0.1;
  if (size >= 1) return 0.01;
  return 0.001;
}

function attachScrubber(
  label: HTMLElement,
  input: HTMLInputElement,
  field: NumericParam,
  update: (value: number) => void,
  finish: () => void,
  begin: () => void = () => {},
): void {
  let startX = 0;
  let startValue = field.value;
  let dragging = false;

  label.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    begin();
    startX = event.clientX;
    const value = Number(input.value);
    startValue = Number.isFinite(value) ? value : field.value;
    label.setPointerCapture(event.pointerId);
    label.classList.add("scrubbing");
  });

  label.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    update(scrubNumericParamValue(field.label, startValue, delta, event));
  });

  label.addEventListener("pointerup", (event) => {
    dragging = false;
    label.releasePointerCapture(event.pointerId);
    label.classList.remove("scrubbing");
    finish();
  });

  label.addEventListener("pointercancel", (event) => {
    dragging = false;
    label.releasePointerCapture(event.pointerId);
    label.classList.remove("scrubbing");
    finish();
  });
}

function mapLabel(kind: string): string {
  return kind.length > 10 ? `${kind.slice(0, 9)}...` : kind;
}

function containsEventTarget(parent: Element, target: EventTarget | null): boolean {
  return target instanceof globalThis.Node && parent.contains(target);
}

function relatedEventTarget(event: Event): EventTarget | null {
  return event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
}

function visibilityShortcutTitle(title: string): string {
  return title === "Root stays visible" ? title : `${title} (V)`;
}

function renderCodeLinkButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);

  const icon = document.createElement("span");
  icon.className = "code-link-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

let nextGraphEditSession = 1;

function nextEditSessionId(prefix: string): string {
  const id = nextGraphEditSession;
  nextGraphEditSession += 1;
  return `${prefix}:${id}`;
}
