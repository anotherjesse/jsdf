import type { Node } from "../core/nodes";
import type { GraphSourceLink } from "./clean-source-patch";
import type { NumericParam } from "./graph-param-model";
import { scrubNumericParamValue } from "./scrub-values";

export function filterTerms(filter: string): string[] {
  return filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function formatNodeLabel(node: Node): string {
  return `${node.kind} #${node.id}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function nudgeDirectionForKey(key: string): -1 | 1 | null {
  if (key === "ArrowLeft" || key === "ArrowDown") return -1;
  if (key === "ArrowRight" || key === "ArrowUp") return 1;
  return null;
}

export function attachScrubber(
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

export function visibilityShortcutTitle(title: string): string {
  return title === "Full shape stays visible" ? title : `${title} (V; Alt-click isolates branch)`;
}

export function breadcrumbRelation(path: readonly Node[], index: number): string {
  if (index === 0) return "root";
  const parent = path[index - 1];
  const child = path[index];
  const childIndex = parent.children.findIndex((entry) => entry.node.id === child.id);
  return childRelationLabel(parent.kind, childIndex < 0 ? index - 1 : childIndex);
}

function childRelationLabel(parentKind: string, childIndex: number): string {
  if (parentKind === "difference") return childIndex === 0 ? "base" : "subtract";
  if (parentKind === "transitionLinear" || parentKind === "transitionRadial") {
    return childIndex === 0 ? "from" : "to";
  }
  if (parentKind === "union" || parentKind === "intersection" || parentKind === "blend") {
    return `part ${childIndex + 1}`;
  }
  return childIndex === 0 ? "input" : `child ${childIndex + 1}`;
}

export function renderCodeLinkButton(label: string, className: string, shortcuts = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  if (shortcuts) button.setAttribute("aria-keyshortcuts", shortcuts);

  const icon = document.createElement("span");
  icon.className = "code-link-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

export function renderIsolateIcon(): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "isolate-icon";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function screenReaderText(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "sr-only";
  span.textContent = text;
  return span;
}

export function renderSourceStatusChip(sourceLink: GraphSourceLink | null): HTMLElement {
  if (sourceLink) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "param-source-chip";
    chip.dataset.state = "linked";
    chip.textContent = "Code";
    chip.title = "Reveal this node in editable code";
    chip.setAttribute("aria-label", chip.title);
    chip.setAttribute("aria-keyshortcuts", "C");
    return chip;
  }

  const chip = document.createElement("span");
  chip.className = "param-source-chip";
  chip.dataset.state = "derived";
  chip.textContent = "Derived";
  chip.title = "This node has no direct editable source range";
  chip.setAttribute("aria-label", chip.title);
  return chip;
}

let nextGraphEditSession = 1;

export function nextEditSessionId(prefix: string): string {
  const id = nextGraphEditSession;
  nextGraphEditSession += 1;
  return `${prefix}:${id}`;
}
