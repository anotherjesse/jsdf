import type { Node, SDF3 } from "../core/nodes";

type ParamPath = Array<string | number>;

export interface GraphInspectorOptions {
  onSelect(node: Node | null): void;
  onEdit(): void;
}

export class GraphInspector {
  private sdf: SDF3 | null = null;
  private selected: Node | null = null;
  private readonly tree = document.createElement("div");
  private readonly params = document.createElement("div");

  constructor(
    private readonly root: HTMLElement,
    private readonly options: GraphInspectorOptions,
  ) {
    root.replaceChildren();
    this.tree.className = "graph-tree";
    this.params.className = "param-editor";
    root.append(this.tree, this.params);
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
    this.tree.replaceChildren();
    this.params.replaceChildren();
    if (!this.sdf) return;
    this.tree.append(this.renderNode(this.sdf.node, 0));
    this.renderParams();
  }

  private renderNode(node: Node, depth: number): HTMLElement {
    const group = document.createElement("div");
    group.className = "graph-node-group";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-node";
    button.style.setProperty("--depth", String(depth));
    button.setAttribute("aria-pressed", String(this.selected?.id === node.id));
    button.dataset.nodeId = String(node.id);
    button.innerHTML = `<span>${node.kind}</span><small>#${node.id} ${node.dim}D</small>`;
    button.addEventListener("click", () => {
      this.selected = node;
      this.render();
      this.options.onSelect(node);
    });
    group.append(button);

    node.children.forEach((child) => {
      group.append(this.renderNode(child.node, depth + 1));
    });
    return group;
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
