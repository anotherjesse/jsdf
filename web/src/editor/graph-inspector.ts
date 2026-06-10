import type { Node, SDF3 } from "../core/nodes";
import { buildGraphModel, childMatchesFilter, type GraphModel, type GraphNodeView } from "./graph-model";
import { buildSoloPreview, type SoloPreview } from "./solo-preview";

type ParamPath = Array<string | number>;

export interface GraphInspectorOptions {
  onSelect(node: Node | null): void;
  onEdit(): void;
  onSolo(preview: SoloPreview | null): void;
}

export class GraphInspector {
  private sdf: SDF3 | null = null;
  private selected: Node | null = null;
  private filter = "";
  private soloKey: string | null = null;
  private readonly toolbar = document.createElement("div");
  private readonly filterInput = document.createElement("input");
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
    this.summary.className = "graph-summary";
    this.filterInput.addEventListener("input", () => {
      this.filter = this.filterInput.value;
      this.render();
    });
    window.addEventListener("pointermove", (event) => {
      if (!event.shiftKey) this.clearSolo();
    }, { capture: true });
    window.addEventListener("pointerup", () => this.clearSolo(), { capture: true });
    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") this.clearSolo();
    });
    window.addEventListener("blur", () => this.clearSolo());
    this.toolbar.append(this.filterInput, this.summary);
    this.map.className = "graph-map";
    this.tree.className = "graph-tree";
    this.params.className = "param-editor";
    root.append(this.toolbar, this.map, this.tree, this.params);
  }

  setSdf(sdf: SDF3): void {
    this.sdf = sdf;
    this.selected = sdf.node;
    this.render();
    this.options.onSelect(this.selected);
  }

  setSelected(node: Node | null): void {
    this.selected = node;
    this.render();
  }

  getSelected(): Node | null {
    return this.selected;
  }

  private render(): void {
    this.map.replaceChildren();
    this.tree.replaceChildren();
    this.params.replaceChildren();
    if (!this.sdf) return;
    const model = buildGraphModel(this.sdf.node, this.filter);
    this.renderSummary(model);
    this.renderMap(model);
    if (model.visibleNodeIds.size === 0) {
      const empty = document.createElement("div");
      empty.className = "param-empty graph-empty";
      empty.textContent = "No matching nodes";
      this.tree.append(empty);
    } else {
      this.tree.append(this.renderNode(this.sdf.node, 0, model, [this.sdf.node]));
    }
    this.renderParams();
  }

  private renderNode(node: Node, depth: number, model: GraphModel, path: Node[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "graph-node-group";
    const view = model.nodeById.get(node.id);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-node";
    if (this.filter && view?.matched) button.classList.add("matched");
    button.style.setProperty("--depth", String(depth));
    button.setAttribute("aria-pressed", String(this.selected?.id === node.id));
    button.dataset.nodeId = String(node.id);
    const label = document.createElement("span");
    label.textContent = node.kind;
    const meta = document.createElement("small");
    const shared = (view?.parents.size ?? 0) > 1;
    meta.textContent = `#${node.id} ${node.dim}D${shared ? " shared" : ""}`;
    button.append(label, meta);
    button.addEventListener("click", () => this.select(node));
    this.attachSoloHover(button, path);
    group.append(button);

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
    this.summary.textContent = this.filter
      ? `${visible}/${total} nodes`
      : `${total} nodes, ${model.edges.length} edges`;
  }

  private renderMap(model: GraphModel): void {
    const nodes = model.nodes.filter((view) => model.visibleNodeIds.has(view.node.id));
    if (nodes.length === 0) {
      this.map.textContent = "";
      return;
    }

    const width = 390;
    const levels = new Map<number, GraphNodeView[]>();
    for (const view of nodes) {
      const level = levels.get(view.depth) ?? [];
      level.push(view);
      levels.set(view.depth, level);
    }
    for (const level of levels.values()) level.sort((a, b) => a.node.id - b.node.id);

    const maxRows = Math.max(...[...levels.values()].map((level) => level.length), 1);
    const height = Math.max(148, Math.min(300, 42 + maxRows * 32));
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
      svg.append(this.renderMapNode(view, position.x, position.y));
    }

    this.map.replaceChildren(svg);
  }

  private renderMapNode(view: GraphNodeView, x: number, y: number): SVGElement {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("graph-map-node");
    if (this.selected?.id === view.node.id) group.classList.add("selected");
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

  private select(node: Node): void {
    this.selected = node;
    this.render();
    this.options.onSelect(node);
  }

  private attachSoloHover(target: Element, path: Node[]): void {
    target.addEventListener("pointerenter", (event) => this.updateSolo(path, event));
    target.addEventListener("pointermove", (event) => this.updateSolo(path, event));
    target.addEventListener("pointerleave", () => this.clearSolo());
  }

  private updateSolo(path: Node[], event: Event): void {
    if (!(event instanceof PointerEvent) || !event.shiftKey) {
      this.clearSolo();
      return;
    }
    const preview = buildSoloPreview(path);
    if (!preview) {
      this.clearSolo();
      return;
    }
    if (preview.key === this.soloKey) return;
    this.soloKey = preview.key;
    this.options.onSolo(preview);
  }

  private clearSolo(): void {
    if (!this.soloKey) return;
    this.soloKey = null;
    this.options.onSolo(null);
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
    const kind = document.createElement("strong");
    kind.textContent = node.kind;
    const id = document.createElement("span");
    id.textContent = `#${node.id}`;
    title.append(kind, id);
    this.params.append(title);

    const fields = collectNumericParams(node.params);
    if (fields.length === 0) {
      const empty = document.createElement("div");
      empty.className = "param-empty";
      empty.textContent = "No numeric params";
      this.params.append(empty);
      return;
    }

    for (const field of fields) {
      this.params.append(this.renderNumberField(node.params, field));
    }
  }

  private renderNumberField(params: Record<string, unknown>, field: NumericParam): HTMLElement {
    const row = document.createElement("label");
    row.className = "param-row";

    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = field.label;

    const input = document.createElement("input");
    input.type = "number";
    input.step = String(stepFor(field.value));
    input.value = formatValue(field.value);

    const range = document.createElement("input");
    range.type = "range";
    range.min = String(field.value - rangeRadius(field.value));
    range.max = String(field.value + rangeRadius(field.value));
    range.step = input.step;
    range.value = input.value;

    const update = (value: number) => {
      if (!Number.isFinite(value)) return;
      setAtPath(params, field.path, value);
      input.value = formatValue(value);
      range.min = String(value - rangeRadius(value));
      range.max = String(value + rangeRadius(value));
      range.value = formatValue(value);
      this.options.onEdit();
    };

    input.addEventListener("input", () => update(Number(input.value)));
    range.addEventListener("input", () => update(Number(range.value)));
    attachScrubber(name, input, field.value, update);

    row.append(name, input, range);
    return row;
  }
}

interface NumericParam {
  label: string;
  path: ParamPath;
  value: number;
}

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

function setAtPath(root: Record<string, unknown>, path: ParamPath, value: number): void {
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

function formatPath(path: ParamPath): string {
  return path.map((part, index) => {
    if (typeof part === "number") return `[${part}]`;
    return index === 0 ? part : `.${part}`;
  }).join("");
}

function formatValue(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4).replace(/\.?0+$/, "");
}

function rangeRadius(value: number): number {
  return Math.max(0.25, Math.abs(value) * 1.5);
}

function stepFor(value: number): number {
  const size = Math.abs(value);
  if (size >= 10) return 0.1;
  if (size >= 1) return 0.01;
  return 0.001;
}

function attachScrubber(label: HTMLElement, input: HTMLInputElement, initialValue: number, update: (value: number) => void): void {
  let startX = 0;
  let startValue = initialValue;
  let dragging = false;

  label.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startValue = Number(input.value) || initialValue;
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
  });

  label.addEventListener("pointercancel", (event) => {
    dragging = false;
    label.releasePointerCapture(event.pointerId);
    label.classList.remove("scrubbing");
  });
}

function mapLabel(kind: string): string {
  return kind.length > 10 ? `${kind.slice(0, 9)}...` : kind;
}
