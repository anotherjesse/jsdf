import type { Node } from "../core/nodes";
import type { GraphSourceLink } from "./clean-source-patch";
import {
  formatParamPath,
  getParamAtPath,
  graphParamKey,
  paramPathStartsWith,
  paramPathsEqual,
  setParamAtPath,
  type GraphParamEdit,
  type ParamPath,
} from "./graph-edit-model";
import {
  ORIENTATION_AXES,
  axisForMatrix,
  cloneMatrix,
  collectNumericParams,
  formatParamNumber,
  matricesClose,
  matrixCellPaths,
  matrixParam,
  orientationMatrix,
  rangeBoundsFor,
  stepFor,
  type NumericParam,
  type OrientationAxis,
} from "./graph-param-model";
import {
  attachScrubber,
  breadcrumbRelation,
  clamp,
  filterTerms,
  formatNodeLabel,
  nextEditSessionId,
  nudgeDirectionForKey,
  renderCodeLinkButton,
  renderIsolateIcon,
  renderSourceStatusChip,
  screenReaderText,
  visibilityShortcutTitle,
} from "./graph-param-panel-controls";
import {
  graphNodePath,
  graphVisibilityMeta,
  graphVisibilityStateForPath,
  renderEyeIcon,
} from "./graph-visibility";
import { nudgeNumericParamValue } from "./scrub-values";
import type { SoloPreview } from "./solo-preview";

export interface GraphParamPanelState {
  root: Node | null;
  selected: Node | null;
  hiddenNodeIds: ReadonlySet<number>;
  dirtyNodeIds: ReadonlySet<number>;
  dirtyParamKeys: ReadonlySet<string>;
  sourceLinks: readonly GraphSourceLink[];
  hoveredSourceLink: GraphSourceLink | null;
  selectedSourceLink: GraphSourceLink | null;
  filter: string;
  lockedSoloNodeId: number | null;
}

export interface GraphParamPanelOptions {
  readState(): GraphParamPanelState;
  soloPreviewForNode(node: Node): SoloPreview | null;
  onSelect(node: Node): void;
  onToggleVisibility(node: Node, options?: { focus?: boolean; isolate?: boolean }): void;
  onToggleLockedSolo(node: Node): void;
  onRevealSource(link: GraphSourceLink): void;
  onSourceHover(link: GraphSourceLink | null): void;
  onEdit(edit: GraphParamEdit): void;
  attachSoloHover(target: Element, path: Node[]): void;
  requestRender(): void;
}

export class GraphParamPanel {
  private readonly customMatrixNodeIds = new Set<number>();

  constructor(
    private readonly root: HTMLElement,
    private readonly options: GraphParamPanelOptions,
  ) {}

  render(): void {
    this.root.replaceChildren();
    const state = this.options.readState();
    const node = state.selected;
    if (!node) {
      this.root.textContent = "";
      return;
    }

    const title = document.createElement("div");
    title.className = "param-title";
    if (state.dirtyNodeIds.has(node.id)) title.classList.add("edited");
    if (this.sourceLinkMatchesNode(state.selectedSourceLink, node.id)) title.classList.add("source-selected");
    const nodeSourceLink = this.sourceLinkForNode(state, node.id);
    const titleText = document.createElement("div");
    titleText.className = "param-title-text";
    const kind = document.createElement("strong");
    kind.textContent = node.kind;
    const id = document.createElement("span");
    id.textContent = `#${node.id}`;
    const sourceChip = renderSourceStatusChip(nodeSourceLink);
    if (nodeSourceLink) {
      sourceChip.addEventListener("click", () => this.options.onRevealSource(nodeSourceLink));
    }
    titleText.append(kind, id, sourceChip);
    title.append(titleText);

    const actions = document.createElement("div");
    actions.className = "param-title-actions";

    const path = graphNodePath(state.root, node.id);
    const { isRoot, directlyHidden, inheritedHidden } = graphVisibilityStateForPath(state.root, state.hiddenNodeIds, node, path);
    const visibilityMeta = graphVisibilityMeta(isRoot, directlyHidden, inheritedHidden);
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "graph-visibility param-visibility";
    visibility.disabled = visibilityMeta.disabled;
    visibility.dataset.state = visibilityMeta.state;
    if (inheritedHidden && !directlyHidden) visibility.classList.add("inherited-hidden");
    visibility.title = visibilityShortcutTitle(visibilityMeta.title);
    visibility.setAttribute("aria-label", `${visibility.title} selected ${node.kind} #${node.id}`);
    visibility.setAttribute("aria-keyshortcuts", "V");
    visibility.setAttribute("aria-pressed", String(visibilityMeta.pressed));
    visibility.append(renderEyeIcon(visibilityMeta.state));
    visibility.addEventListener("click", (event) => this.options.onToggleVisibility(node, { isolate: event.altKey }));
    actions.append(visibility);

    if (nodeSourceLink) {
      const source = renderCodeLinkButton(
        `Reveal ${node.kind} #${node.id} in code (C)`,
        "param-title-button param-code-link",
        "C",
      );
      source.addEventListener("click", () => this.options.onRevealSource(nodeSourceLink));
      actions.append(source);
    }

    const soloPreview = this.options.soloPreviewForNode(node);
    if (soloPreview) {
      const isolate = document.createElement("button");
      isolate.type = "button";
      isolate.className = "param-title-button param-isolate icon-button";
      isolate.title = "Isolate selected node in preview (I)";
      isolate.setAttribute("aria-label", "Isolate selected node in preview");
      isolate.setAttribute("aria-keyshortcuts", "I");
      isolate.setAttribute("aria-pressed", String(node.id === state.lockedSoloNodeId));
      isolate.append(renderIsolateIcon(), screenReaderText("Isolate"));
      isolate.addEventListener("click", () => this.options.onToggleLockedSolo(node));
      actions.append(isolate);
    }
    if (actions.childElementCount > 0) title.append(actions);
    this.root.append(title);

    const breadcrumb = this.renderBreadcrumb(node, state);
    if (breadcrumb) this.root.append(breadcrumb);

    const orientationControl = this.renderOrientationControl(node, state);
    if (orientationControl) this.root.append(orientationControl);
    const matrixControl = this.renderMatrixControl(node, state);
    if (matrixControl) this.root.append(matrixControl);

    const fields = collectNumericParams(node.params)
      .filter((field) => {
        if (matrixControl && field.path[0] === "matrix") return false;
        return orientationControl == null || this.shouldShowMatrixFields(node, field);
      });
    if (fields.length === 0 && !orientationControl) {
      const empty = document.createElement("div");
      empty.className = "param-empty";
      empty.textContent = "No numeric params";
      this.root.append(empty);
      return;
    }

    for (const field of fields) {
      this.root.append(this.renderNumberField(node, field, state));
    }
  }

  private renderBreadcrumb(node: Node, state: GraphParamPanelState): HTMLElement | null {
    const path = graphNodePath(state.root, node.id);
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
      const relation = breadcrumbRelation(path, index);
      button.title = `${relation}: ${crumb.kind} #${crumb.id}`;
      button.setAttribute("aria-label", button.title);
      const relationLabel = document.createElement("small");
      relationLabel.textContent = relation;
      const nodeLabel = document.createElement("span");
      nodeLabel.textContent = `${crumb.kind} #${crumb.id}`;
      button.append(relationLabel, nodeLabel);
      this.options.attachSoloHover(button, path.slice(0, index + 1));
      if (crumb.id === node.id) {
        button.setAttribute("aria-current", "page");
      } else {
        button.addEventListener("click", () => this.options.onSelect(crumb));
      }
      trail.append(button);
    });

    return trail;
  }

  private renderOrientationControl(node: Node, state: GraphParamPanelState): HTMLElement | null {
    if (node.kind !== "rotate3") return null;
    const matrix = matrixParam(node.params.matrix);
    if (!matrix) return null;

    const activeAxis = axisForMatrix(matrix);
    const showCustom = activeAxis === "custom" || this.customMatrixNodeIds.has(node.id);
    const group = document.createElement("div");
    group.className = "axis-control";
    if (this.matchesFilterText(state, "orient", "axis", "matrix", activeAxis)) group.classList.add("matched");
    if (state.dirtyParamKeys.has(graphParamKey(node.id, ["matrix"]))) group.classList.add("edited");
    if (this.sourceLinkMatchesParam(state.hoveredSourceLink, node.id, ["matrix"])) group.classList.add("source-hovered");
    if (this.sourceLinkMatchesParam(state.selectedSourceLink, node.id, ["matrix"])) group.classList.add("source-selected");
    this.attachSourceHover(group, this.sourceLinkForParam(state, node.id, ["matrix"]));

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
      this.options.requestRender();
    });
    buttons.append(custom);

    group.append(label, buttons);
    return group;
  }

  private renderMatrixControl(node: Node, state: GraphParamPanelState): HTMLElement | null {
    if (node.kind !== "rotate3") return null;
    const matrix = matrixParam(node.params.matrix);
    if (!matrix) return null;
    const activeAxis = axisForMatrix(matrix);
    if (activeAxis !== "custom" && !this.customMatrixNodeIds.has(node.id)) return null;

    const sourceLink = this.sourceLinkForParam(state, node.id, ["matrix"]);
    const group = document.createElement("div");
    group.className = "matrix-control";
    if (this.matrixMatchesFilter(state, matrix)) group.classList.add("matched");
    if (matrixCellPaths().some((path) => state.dirtyParamKeys.has(graphParamKey(node.id, path)))) group.classList.add("edited");
    if (this.sourceLinkMatchesParam(state.hoveredSourceLink, node.id, ["matrix"])) group.classList.add("source-hovered");
    if (this.sourceLinkMatchesParam(state.selectedSourceLink, node.id, ["matrix"])) group.classList.add("source-selected");
    this.attachSourceHover(group, sourceLink);

    const header = document.createElement("div");
    header.className = "matrix-control-header";
    const label = document.createElement("span");
    label.className = "matrix-label";
    label.textContent = "Matrix";
    header.append(label);
    if (sourceLink) {
      const source = renderCodeLinkButton(
        `Reveal ${formatNodeLabel(node)} orientation in code`,
        "param-source-link matrix-source-link",
      );
      source.addEventListener("click", (event) => {
        event.preventDefault();
        this.options.onRevealSource(sourceLink);
      });
      header.append(source);
    }

    const grid = document.createElement("div");
    grid.className = "matrix-grid";
    matrix.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.min = "-1";
        input.max = "1";
        input.value = formatParamNumber(value);
        input.setAttribute(
          "aria-label",
          `${formatNodeLabel(node)} orientation matrix row ${rowIndex + 1} column ${columnIndex + 1}`,
        );

        let editSessionId: string | null = null;
        input.addEventListener("focus", () => {
          editSessionId = nextEditSessionId("matrix-cell");
        });
        input.addEventListener("blur", () => {
          editSessionId = null;
        });
        input.addEventListener("input", () => {
          this.updateMatrixCell(node, rowIndex, columnIndex, Number(input.value), editSessionId);
        });
        grid.append(input);
      });
    });

    group.append(header, grid);
    return group;
  }

  private setOrientationAxis(node: Node, previous: number[][], axis: OrientationAxis): void {
    const nextValue = orientationMatrix(axis);
    if (matricesClose(previous, nextValue)) {
      this.customMatrixNodeIds.delete(node.id);
      this.options.requestRender();
      return;
    }

    setParamAtPath(node.params, ["matrix"], cloneMatrix(nextValue));
    this.customMatrixNodeIds.delete(node.id);
    this.options.requestRender();
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

  private updateMatrixCell(
    node: Node,
    rowIndex: number,
    columnIndex: number,
    value: number,
    editSessionId: string | null,
  ): void {
    if (!Number.isFinite(value)) return;
    const path: ParamPath = ["matrix", rowIndex, columnIndex];
    const previousValue = getParamAtPath(node.params, path);
    if (typeof previousValue !== "number" || previousValue === value) return;
    setParamAtPath(node.params, path, value);
    this.customMatrixNodeIds.add(node.id);
    this.options.onEdit({
      node,
      nodeId: node.id,
      nodeKind: node.kind,
      path,
      label: formatParamPath(path),
      previousValue,
      nextValue: value,
      ...(editSessionId ? { editSessionId } : {}),
    });
  }

  private shouldShowMatrixFields(node: Node, field: NumericParam): boolean {
    return node.kind !== "rotate3" || field.path[0] !== "matrix" || this.customMatrixNodeIds.has(node.id) || axisForMatrix(matrixParam(node.params.matrix)) === "custom";
  }

  private renderNumberField(node: Node, field: NumericParam, state: GraphParamPanelState): HTMLElement {
    const row = document.createElement("div");
    row.className = "param-row";
    if (this.numericParamMatchesFilter(field, state)) row.classList.add("matched");
    if (state.dirtyParamKeys.has(graphParamKey(node.id, field.path))) row.classList.add("edited");
    if (this.sourceLinkMatchesParam(state.hoveredSourceLink, node.id, field.path)) row.classList.add("source-hovered");
    if (this.sourceLinkMatchesParam(state.selectedSourceLink, node.id, field.path)) row.classList.add("source-selected");

    const sourceLink = this.sourceLinkForParam(state, node.id, field.path);
    this.attachSourceHover(row, sourceLink);
    const nameGroup = document.createElement("span");
    nameGroup.className = "param-name-group";

    const name = document.createElement("span");
    const fieldLabel = `${formatNodeLabel(node)} ${field.label}`;
    name.className = "param-name";
    name.textContent = field.label;
    name.tabIndex = 0;
    name.title = "Drag horizontally, or use arrow keys, to scrub";
    name.setAttribute("role", "button");
    name.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");
    name.setAttribute("aria-label", `${fieldLabel} scrub handle`);
    nameGroup.append(name);

    if (sourceLink) {
      const source = renderCodeLinkButton(`Reveal ${formatNodeLabel(node)} ${field.label} in code`, "param-source-link");
      source.addEventListener("click", (event) => {
        event.preventDefault();
        this.options.onRevealSource(sourceLink);
      });
      nameGroup.append(source);
    }

    const input = document.createElement("input");
    input.type = "number";
    input.step = String(stepFor(field));
    input.value = formatParamNumber(field.value);
    input.setAttribute("aria-label", `${fieldLabel} value`);

    const range = document.createElement("input");
    range.type = "range";
    range.step = input.step;
    range.value = input.value;
    range.setAttribute("aria-label", `${fieldLabel} slider`);

    const rangeGroup = document.createElement("div");
    rangeGroup.className = "param-range";
    const rangeLabels = document.createElement("div");
    rangeLabels.className = "param-range-labels";
    const minLabel = document.createElement("span");
    minLabel.className = "param-range-bound";
    minLabel.dataset.bound = "min";
    const maxLabel = document.createElement("span");
    maxLabel.className = "param-range-bound";
    maxLabel.dataset.bound = "max";
    rangeLabels.append(minLabel, maxLabel);
    rangeGroup.append(range, rangeLabels);

    const recenterRange = (value: number) => {
      const bounds = rangeBoundsFor(field, value);
      range.min = formatParamNumber(bounds.min);
      range.max = formatParamNumber(bounds.max);
      range.value = formatParamNumber(value);
      minLabel.textContent = range.min;
      maxLabel.textContent = range.max;
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
      const previousValue = getParamAtPath(node.params, field.path);
      if (typeof previousValue !== "number") return;
      if (previousValue === nextValue) return;
      setParamAtPath(node.params, field.path, nextValue);
      input.value = formatParamNumber(nextValue);
      if (options.recenterRange !== false) {
        recenterRange(nextValue);
      } else {
        range.value = formatParamNumber(nextValue);
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
    name.addEventListener("focus", beginEditSession);
    name.addEventListener("blur", endEditSession);
    name.addEventListener("keydown", (event) => {
      const direction = nudgeDirectionForKey(event.key);
      if (!direction) return;
      event.preventDefault();
      beginEditSession();
      const currentValue = Number(input.value);
      const startValue = Number.isFinite(currentValue) ? currentValue : field.value;
      update(nudgeNumericParamValue(field.label, startValue, direction, event), {
        clampToRange: true,
        recenterRange: false,
        editSessionId,
      });
    });
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
        range.value = formatParamNumber(Number(input.value));
        endEditSession();
      },
      beginEditSession,
    );

    row.append(nameGroup, input, rangeGroup);
    return row;
  }

  private sourceLinkForParam(state: GraphParamPanelState, nodeId: number, path: ParamPath): GraphSourceLink | null {
    const exact = state.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.end > link.start && paramPathsEqual(link.path, path);
    });
    if (exact) return exact;
    return state.sourceLinks.find((link) => {
      return link.nodeId === nodeId
        && link.end > link.start
        && link.scrubbable === false
        && paramPathStartsWith(path, link.path);
    }) ?? null;
  }

  private numericParamMatchesFilter(field: NumericParam, state: GraphParamPanelState): boolean {
    return this.matchesFilterText(state, field.label, String(field.value), ...field.path.map(String));
  }

  private matrixMatchesFilter(state: GraphParamPanelState, matrix: number[][]): boolean {
    const parts = ["matrix"];
    matrix.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        parts.push(`matrix[${rowIndex}][${columnIndex}]`, String(value));
      });
    });
    return this.matchesFilterText(state, ...parts);
  }

  private matchesFilterText(state: GraphParamPanelState, ...parts: string[]): boolean {
    const terms = filterTerms(state.filter);
    if (terms.length === 0) return false;
    const text = parts.join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  }

  private sourceLinkMatchesParam(link: GraphSourceLink | null, nodeId: number, path: ParamPath): boolean {
    if (!link || link.nodeId !== nodeId || link.end <= link.start) return false;
    return paramPathsEqual(link.path, path) || (link.scrubbable === false && paramPathStartsWith(path, link.path));
  }

  private sourceLinkMatchesNode(link: GraphSourceLink | null, nodeId: number): boolean {
    return Boolean(link && link.nodeId === nodeId && link.label === "call" && link.end > link.start);
  }

  private sourceLinkForNode(state: GraphParamPanelState, nodeId: number): GraphSourceLink | null {
    return state.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.label === "call" && link.end > link.start;
    }) ?? state.sourceLinks.find((link) => {
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
