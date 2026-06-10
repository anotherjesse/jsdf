import type { Node, SDF3 } from "../core/nodes";
import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import type { GraphSourceLink } from "./clean-source-patch";
import { buildGraphModel, childMatchesFilter, type GraphModel, type GraphNodeView } from "./graph-model";
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
}

export interface GraphInspectorOptions {
  onSelect(node: Node | null): void;
  onHover(node: Node | null, options: GraphHoverOptions): void;
  onEdit(edit: GraphParamEdit): void;
  onSolo(preview: SoloPreview | null): void;
  onRevealSource(link: GraphSourceLink): void;
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
  private hoverSoloKey: string | null = null;
  private lockedSoloKey: string | null = null;
  private lockedSoloNodeId: number | null = null;
  private revealSelectedAfterRender = false;
  private readonly hiddenNodeIds = new Set<number>();
  private readonly customMatrixNodeIds = new Set<number>();
  private readonly toolbar = document.createElement("div");
  private readonly filterInput = document.createElement("input");
  private readonly mapButton = document.createElement("button");
  private readonly showAllButton = document.createElement("button");
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
    this.mapButton.type = "button";
    this.mapButton.className = "graph-map-toggle";
    this.mapButton.textContent = "Map";
    this.mapButton.title = "Toggle graph map";
    this.mapButton.setAttribute("aria-label", "Toggle graph map");
    this.mapButton.setAttribute("aria-pressed", "false");
    this.showAllButton.type = "button";
    this.showAllButton.className = "graph-show-all";
    this.showAllButton.textContent = "Show all";
    this.showAllButton.title = "Show all hidden nodes";
    this.showAllButton.setAttribute("aria-label", "Show all hidden graph nodes");
    this.showAllButton.hidden = true;
    this.summary.className = "graph-summary";
    this.filterInput.addEventListener("input", () => {
      this.filter = this.filterInput.value;
      this.render();
    });
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
    this.toolbar.append(this.filterInput, this.mapButton, this.showAllButton, this.summary);
    this.map.className = "graph-map";
    this.tree.className = "graph-tree";
    this.params.className = "param-editor";
    root.append(this.toolbar, this.map, this.tree, this.params);
  }

  setSdf(sdf: SDF3): void {
    this.sdf = sdf;
    this.selected = sdf.node;
    this.hoverSoloKey = null;
    this.lockedSoloKey = null;
    this.lockedSoloNodeId = null;
    this.hiddenNodeIds.clear();
    this.render();
    this.options.onSelect(this.selected);
    this.options.onVisibilityChange([]);
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
    this.showAllButton.hidden = this.hiddenNodeIds.size === 0;
    this.map.hidden = !this.showMap;
    if (this.showMap) this.renderMap(model);
    if (model.visibleNodeIds.size === 0) {
      const empty = document.createElement("div");
      empty.className = "param-empty graph-empty";
      empty.textContent = "No matching nodes";
      this.tree.append(empty);
    } else {
      this.tree.append(this.renderNode(this.sdf.node, 0, model, [this.sdf.node]));
    }
    this.renderParams();
    this.revealSelectedNode();
  }

  private renderNode(node: Node, depth: number, model: GraphModel, path: Node[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "graph-node-group";
    const view = model.nodeById.get(node.id);

    const row = document.createElement("div");
    row.className = "graph-node-row";
    row.style.setProperty("--depth", String(depth));

    const isRoot = this.sdf?.node.id === node.id;
    const directlyHidden = this.hiddenNodeIds.has(node.id);
    const inheritedHidden = path.slice(0, -1).some((ancestor) => this.hiddenNodeIds.has(ancestor.id));
    const effectivelyHidden = directlyHidden || inheritedHidden;
    if (effectivelyHidden) row.classList.add("hidden-node-row");
    if (inheritedHidden && !directlyHidden) row.classList.add("inherited-hidden");

    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "graph-visibility";
    visibility.disabled = isRoot;
    if (inheritedHidden && !directlyHidden) visibility.classList.add("inherited-hidden");
    visibility.title = visibilityTitle(isRoot, directlyHidden, inheritedHidden);
    visibility.setAttribute("aria-label", `${visibility.title} ${node.kind} #${node.id}`);
    visibility.setAttribute("aria-pressed", String(!directlyHidden));
    visibility.append(renderEyeIcon());
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
    button.setAttribute("aria-pressed", String(this.selected?.id === node.id));
    button.dataset.nodeId = String(node.id);
    const label = document.createElement("span");
    label.textContent = node.kind;
    const meta = document.createElement("small");
    const shared = (view?.parents.size ?? 0) > 1;
    meta.textContent = `#${node.id} ${node.dim}D${shared ? " shared" : ""}${directlyHidden ? " hidden" : inheritedHidden ? " parent hidden" : ""}`;
    button.append(label, meta);
    button.addEventListener("click", () => this.select(node));
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
    const hidden = this.hiddenNodeIds.size;
    const suffix = hidden > 0 ? `, ${hidden} hidden` : "";
    this.summary.textContent = this.filter
      ? `${visible}/${total} nodes${suffix}`
      : `${total} nodes, ${model.edges.length} edges${suffix}`;
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
    const directlyHidden = this.hiddenNodeIds.has(view.node.id);
    if (directlyHidden) group.classList.add("hidden-node");
    if (!directlyHidden && !effectiveVisibleNodeIds.has(view.node.id)) group.classList.add("inherited-hidden");
    if (this.filter && view.matched) group.classList.add("matched");
    if (view.parents.size > 1) group.classList.add("shared");
    group.dataset.nodeId = String(view.node.id);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${view.node.kind} #${view.node.id}`);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x - 38));
    rect.setAttribute("y", String(y - 12));
    rect.setAttribute("width", "76");
    rect.setAttribute("height", "24");
    rect.setAttribute("rx", "6");

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y + 4));
    text.textContent = mapLabel(view.node.kind);

    group.append(rect, text);
    group.addEventListener("click", () => this.select(view.node));
    this.attachSoloHover(group, this.pathToNode(view.node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.select(view.node);
      }
    });
    return group;
  }

  private toggleNodeVisibility(node: Node): void {
    if (this.hiddenNodeIds.has(node.id)) {
      this.hiddenNodeIds.delete(node.id);
    } else {
      this.hiddenNodeIds.add(node.id);
    }
    this.render();
    this.options.onVisibilityChange([...this.hiddenNodeIds]);
  }

  private showAllNodes(): void {
    if (this.hiddenNodeIds.size === 0) return;
    this.hiddenNodeIds.clear();
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

  private select(node: Node): void {
    this.clearLockedSoloIfDifferent(node);
    this.selected = node;
    this.revealSelectedAfterRender = true;
    this.render();
    this.options.onSelect(node);
  }

  private revealSelectedNode(): void {
    if (!this.revealSelectedAfterRender || !this.selected) return;
    this.revealSelectedAfterRender = false;
    const target = this.tree.querySelector<HTMLElement>(`[data-node-id="${this.selected.id}"]`);
    window.requestAnimationFrame(() => {
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private attachSoloHover(target: Element, path: Node[]): void {
    target.addEventListener("pointerenter", (event) => this.updateHover(path, event));
    target.addEventListener("pointermove", (event) => this.updateHover(path, event));
    target.addEventListener("pointerleave", () => {
      this.clearHover();
      this.clearSolo();
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

  private toggleLockedSolo(node: Node): void {
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
    const titleText = document.createElement("div");
    titleText.className = "param-title-text";
    const kind = document.createElement("strong");
    kind.textContent = node.kind;
    const id = document.createElement("span");
    id.textContent = `#${node.id}`;
    titleText.append(kind, id);
    title.append(titleText);

    const soloPreview = this.soloPreviewForNode(node);
    if (soloPreview) {
      const isolate = document.createElement("button");
      isolate.type = "button";
      isolate.className = "param-isolate";
      isolate.textContent = "Isolate";
      isolate.title = "Isolate selected node in preview";
      isolate.setAttribute("aria-label", "Isolate selected node in preview");
      isolate.setAttribute("aria-pressed", String(node.id === this.lockedSoloNodeId));
      isolate.addEventListener("click", () => this.toggleLockedSolo(node));
      title.append(isolate);
    }
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
      if (crumb.id === node.id) {
        button.setAttribute("aria-current", "page");
      } else {
        button.addEventListener("click", () => this.select(crumb));
      }
      trail.append(button);
    });

    return trail;
  }

  private renderOrientationControl(node: Node): HTMLElement | null {
    if (node.kind !== "rotate3") return null;
    const matrix = matrixParam(node.params.matrix);
    if (!matrix) return null;

    const activeAxis = axisForMatrix(matrix);
    const showCustom = activeAxis === "custom" || this.customMatrixNodeIds.has(node.id);
    const group = document.createElement("div");
    group.className = "axis-control";

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

    const sourceLink = this.sourceLinkForParam(node.id, field.path);
    const nameGroup = document.createElement("span");
    nameGroup.className = "param-name-group";

    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = field.label;
    nameGroup.append(name);

    if (sourceLink) {
      const source = document.createElement("button");
      source.type = "button";
      source.className = "param-source-link";
      source.textContent = "Code";
      source.title = `Reveal ${field.label} in code`;
      source.setAttribute("aria-label", `Reveal ${field.label} in code`);
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

    const update = (value: number, options: { clampToRange?: boolean; recenterRange?: boolean } = {}) => {
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
      });
    };

    input.addEventListener("input", () => update(Number(input.value)));
    range.addEventListener("input", () => update(Number(range.value), { recenterRange: false }));
    attachScrubber(
      name,
      input,
      field.value,
      (value) => update(value, { clampToRange: true, recenterRange: false }),
      () => {
        range.value = formatValue(Number(input.value));
      },
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

function pathStartsWith(path: ParamPath, prefix: ParamPath): boolean {
  return prefix.length > 0 && prefix.length < path.length && prefix.every((part, index) => part === path[index]);
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
  return label === "count" || label.endsWith(".count");
}

function isNonNegativeParam(label: string): boolean {
  if (label.startsWith("entries[") && label.endsWith(".k")) return true;
  return /(^|\.)(radius|r|r0|r1|thickness|h|padding|scaledistance)$/.test(label)
    || label.startsWith("size")
    || label.startsWith("factor")
    || label.startsWith("spacing");
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
  initialValue: number,
  update: (value: number) => void,
  finish: () => void,
): void {
  let startX = 0;
  let startValue = initialValue;
  let dragging = false;

  label.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    const value = Number(input.value);
    startValue = Number.isFinite(value) ? value : initialValue;
    label.setPointerCapture(event.pointerId);
    label.classList.add("scrubbing");
  });

  label.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    const step = event.shiftKey ? 0.01 : event.altKey ? 0.001 : 0.05;
    update(startValue + delta * step);
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

function visibilityTitle(isRoot: boolean, directlyHidden: boolean, inheritedHidden: boolean): string {
  if (isRoot) return "Root stays visible";
  if (directlyHidden) return "Show node";
  if (inheritedHidden) return "Hide node; parent is already hidden";
  return "Hide node";
}

function renderEyeIcon(): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "eye-icon";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
