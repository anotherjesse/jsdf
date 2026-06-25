import type { Bounds3 } from "../mesh/bounds";

type BoundsAxis = 0 | 1 | 2;
type BoundsSide = 0 | 1;

interface BoundsInput {
  axis: BoundsAxis;
  side: BoundsSide;
  input: HTMLInputElement;
}

export interface BoundsEditor {
  setBounds(bounds: Bounds3): void;
  setDisabled(disabled: boolean): void;
}

export interface BoundsEditorOptions {
  onChange(bounds: Bounds3): void;
  onInvalid(message: string): void;
}

const AXES: Array<{ axis: BoundsAxis; label: string }> = [
  { axis: 0, label: "X" },
  { axis: 1, label: "Y" },
  { axis: 2, label: "Z" },
];

export function createBoundsEditor(root: HTMLElement, initialBounds: Bounds3, options: BoundsEditorOptions): BoundsEditor {
  const inputs: BoundsInput[] = [];
  let suppress = false;

  root.replaceChildren();
  root.classList.add("bounds-editor");
  root.append(renderHeader());

  for (const { axis, label } of AXES) {
    const row = document.createElement("div");
    row.className = "bounds-row";

    const axisLabel = document.createElement("span");
    axisLabel.className = "bounds-axis";
    axisLabel.textContent = label;

    const minInput = renderInput(`${label} min`);
    const maxInput = renderInput(`${label} max`);
    inputs.push({ axis, side: 0, input: minInput }, { axis, side: 1, input: maxInput });

    row.append(axisLabel, minInput, maxInput);
    root.append(row);
  }

  const readBounds = (): Bounds3 | null => {
    const next: Bounds3 = [[0, 0, 0], [0, 0, 0]];
    for (const { axis, side, input } of inputs) {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return null;
      next[side][axis] = value;
    }
    return next;
  };

  const validate = (bounds: Bounds3 | null): bounds is Bounds3 => {
    if (!bounds) {
      root.dataset.invalid = "true";
      options.onInvalid("Bounds need numeric min and max values");
      return false;
    }

    for (const { axis, label } of AXES) {
      if (bounds[0][axis] >= bounds[1][axis]) {
        root.dataset.invalid = "true";
        options.onInvalid(`${label} min must be less than ${label} max`);
        return false;
      }
    }

    delete root.dataset.invalid;
    return true;
  };

  const handleInput = () => {
    if (suppress) return;
    const bounds = readBounds();
    if (!validate(bounds)) return;
    options.onChange(bounds);
  };

  for (const { input } of inputs) {
    input.addEventListener("input", handleInput);
  }

  const editor: BoundsEditor = {
    setBounds(bounds: Bounds3) {
      suppress = true;
      for (const { axis, side, input } of inputs) {
        input.value = formatBound(bounds[side][axis]);
      }
      suppress = false;
      validate(readBounds());
    },
    setDisabled(disabled: boolean) {
      for (const { input } of inputs) input.disabled = disabled;
    },
  };

  editor.setBounds(initialBounds);
  return editor;
}

function renderHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "bounds-row bounds-header";
  header.setAttribute("aria-hidden", "true");
  header.append(document.createElement("span"), labelCell("Min"), labelCell("Max"));
  return header;
}

function renderInput(label: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.05";
  input.inputMode = "decimal";
  input.setAttribute("aria-label", label);
  return input;
}

function labelCell(value: string): HTMLSpanElement {
  const cell = document.createElement("span");
  cell.textContent = value;
  return cell;
}

function formatBound(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
