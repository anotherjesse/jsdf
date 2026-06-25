import type { Node, SDF3 } from "../core/nodes";
import type { GraphSourceLink } from "./clean-source-patch";
import { buildGraphModel, childMatchesFilter, type GraphModel, type GraphNodeView } from "./graph-model";
import { GraphInspectorToolbar } from "./graph-inspector-toolbar";
import { renderGraphMap } from "./graph-map-renderer";
import { GraphParamPanel } from "./graph-param-panel";
import { renderGraphTree } from "./graph-tree-renderer";
import {
  findGraphNode,
  graphNodeIdSetsEqual,
  graphNodePath,
  hiddenNodeIdsForIsolatedGraphNode,
} from "./graph-visibility";
import {
  getParamAtPath,
  graphParamKey,
  setParamAtPath,
  type GraphDirtyParam,
  type GraphParamEdit,
  type ParamPath,
  type ParamValue,
} from "./graph-edit-model";
import { buildSoloPreview, type SoloPreview } from "./solo-preview";
import { sourceLinksEqual } from "./source-link-matching";

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
  private pointerHoverPath: Node[] | null = null;
  private focusHoverNodeId: number | null = null;
  private lockedSoloKey: string | null = null;
  private lockedSoloNodeId: number | null = null;
  private revealSelectedAfterRender = false;
  private focusSelectedAfterRender = false;
  private readonly hiddenNodeIds = new Set<number>();
  private readonly dirtyNodeIds = new Set<number>();
  private readonly dirtyParamKeys = new Set<string>();
  private readonly toolbar: GraphInspectorToolbar;
  private readonly map = document.createElement("div");
  private readonly tree = document.createElement("div");
  private readonly params = document.createElement("div");
  private readonly paramPanel: GraphParamPanel;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: GraphInspectorOptions,
  ) {
    root.replaceChildren();
    this.toolbar = new GraphInspectorToolbar({
      onFilterChange: (filter) => {
        this.filter = filter;
        this.render();
      },
      onSelectMatch: (direction) => this.selectFilterMatch(direction),
      onToggleMap: (showMap) => {
        this.showMap = showMap;
        this.render();
      },
      onShowAllNodes: () => this.showAllNodes(),
    });
    window.addEventListener("pointermove", (event) => {
      if (!(event.target instanceof globalThis.Node) || !this.root.contains(event.target)) {
        this.clearHover();
      }
    }, { capture: true });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Shift" && !event.repeat) this.refreshPointerHover(true);
    });
    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") {
        this.refreshPointerHover(false);
      }
    });
    root.addEventListener("pointerleave", () => {
      this.clearHover();
    });
    this.map.className = "graph-map";
    this.tree.className = "graph-tree";
    this.tree.tabIndex = 0;
    this.tree.setAttribute("role", "tree");
    this.tree.setAttribute("aria-label", "SDF graph nodes");
    this.tree.addEventListener("keydown", (event) => {
      if (event.target !== this.tree || !this.selected) return;
      this.handleNodeKeyDown(event, this.selected);
    });
    this.params.className = "param-editor";
    this.paramPanel = new GraphParamPanel(this.params, {
      readState: () => ({
        root: this.sdf?.node ?? null,
        selected: this.selected,
        hiddenNodeIds: this.hiddenNodeIds,
        dirtyNodeIds: this.dirtyNodeIds,
        dirtyParamKeys: this.dirtyParamKeys,
        sourceLinks: this.sourceLinks,
        hoveredSourceLink: this.hoveredSourceLink,
        selectedSourceLink: this.selectedSourceLink,
        filter: this.filter,
        lockedSoloNodeId: this.lockedSoloNodeId,
      }),
      soloPreviewForNode: (node) => this.soloPreviewForNode(node),
      onSelect: (node) => this.select(node),
      onToggleVisibility: (node, toggleOptions) => this.toggleNodeVisibility(node, toggleOptions),
      onToggleLockedSolo: (node) => this.toggleLockedSolo(node),
      onRevealSource: (link) => this.options.onRevealSource(link),
      onSourceHover: (link) => this.options.onSourceHover(link),
      onEdit: (edit) => this.options.onEdit(edit),
      attachSoloHover: (target, path) => this.attachSoloHover(target, path),
      requestRender: () => this.render(),
    });
    root.append(this.toolbar.element, this.map, this.tree, this.params);
  }

  setSdf(sdf: SDF3, hiddenNodeIds: readonly number[] = []): void {
    this.sdf = sdf;
    this.selected = sdf.node;
    this.hoveredSourceLink = null;
    this.selectedSourceLink = null;
    this.pointerHoverPath = null;
    this.focusHoverNodeId = null;
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
    const node = findGraphNode(this.sdf.node, id);
    if (this.hovered?.id === node?.id) return node;
    this.hovered = node;
    this.render();
    return node;
  }

  setFocusHoveredNodeById(id: number | null): void {
    const nextId = id != null && this.sdf && findGraphNode(this.sdf.node, id) ? id : null;
    const previousId = this.focusHoverNodeId;
    if (previousId === nextId) return;
    this.focusHoverNodeId = nextId;
    this.syncFocusHoverClass(previousId, nextId);
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
      this.dirtyParamKeys.add(graphParamKey(param.nodeId, param.path));
    }
    this.render();
  }

  selectNodeById(id: number): Node | null {
    if (!this.sdf) return null;
    const node = findGraphNode(this.sdf.node, id);
    if (!node) return null;
    this.select(node);
    return node;
  }

  revealSelected(options: { focus?: boolean } = {}): void {
    if (!this.selected) return;
    this.revealSelectedAfterRender = true;
    this.focusSelectedAfterRender = this.focusSelectedAfterRender || Boolean(options.focus);
    this.render();
  }

  focusFilter(options: { select?: boolean } = {}): void {
    this.toolbar.focusFilter(options);
  }

  buildSoloPreviewForNodeId(id: number): SoloPreview | null {
    return buildSoloPreview(graphNodePath(this.sdf?.node ?? null, id));
  }

  getSelected(): Node | null {
    return this.selected;
  }

  getParamValue(nodeId: number, path: ParamPath): ParamValue | undefined {
    if (!this.sdf) return undefined;
    const node = findGraphNode(this.sdf.node, nodeId);
    return node ? getParamAtPath(node.params, path) : undefined;
  }

  setParamValue(nodeId: number, path: ParamPath, value: ParamValue): Node | null {
    if (!this.sdf) return null;
    const node = findGraphNode(this.sdf.node, nodeId);
    if (!node) return null;
    this.clearLockedSoloIfDifferent(node);
    setParamAtPath(node.params, path, value);
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
    const matched = this.matchingNodes(model).length;
    this.toolbar.updateStats({
      filter: this.filter,
      total: model.nodes.length,
      edges: model.edges.length,
      visible: model.visibleNodeIds.size,
      matched,
      hidden: this.hiddenNodeIds.size,
    });
    this.map.hidden = !this.showMap;
    if (this.showMap) this.renderMap(model);
    this.renderTree(model);
    this.renderParams();
    this.syncTreeActiveDescendant();
    this.revealSelectedNode();
  }

  private renderTree(model: GraphModel): void {
    if (!this.sdf) return;
    renderGraphTree({
      container: this.tree,
      root: this.sdf.node,
      model,
      hiddenNodeIds: this.hiddenNodeIds,
      selectedNodeId: this.selected?.id ?? null,
      hoveredNodeId: this.hovered?.id ?? null,
      focusHoverNodeId: this.focusHoverNodeId,
      lockedSoloNodeId: this.lockedSoloNodeId,
      dirtyNodeIds: this.dirtyNodeIds,
      filter: this.filter,
      nodeKeyboardShortcuts: (node) => this.nodeKeyboardShortcuts(node),
      soloPreviewForNode: (node) => this.soloPreviewForNode(node),
      onSelect: (node) => this.select(node),
      onToggleVisibility: (node, options) => this.toggleNodeVisibility(node, options),
      onToggleLockedSolo: (node) => this.toggleLockedSolo(node),
      onShowAllNodes: (options) => this.showAllNodes(options),
      onKeyDown: (event, node) => this.handleNodeKeyDown(event, node),
      attachSoloHover: (target, path) => this.attachSoloHover(target, path),
    });
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
    if (!this.sdf) return;
    renderGraphMap({
      container: this.map,
      root: this.sdf.node,
      model,
      hiddenNodeIds: this.hiddenNodeIds,
      selectedNodeId: this.selected?.id ?? null,
      hoveredNodeId: this.hovered?.id ?? null,
      focusHoverNodeId: this.focusHoverNodeId,
      lockedSoloNodeId: this.lockedSoloNodeId,
      dirtyNodeIds: this.dirtyNodeIds,
      filter: this.filter,
      nodeKeyboardShortcuts: (node) => this.nodeKeyboardShortcuts(node),
      onSelect: (node) => this.select(node),
      onToggleVisibility: (node, options) => this.toggleNodeVisibility(node, options),
      onKeyDown: (event, node) => this.handleNodeKeyDown(event, node),
      attachSoloHover: (target, path) => this.attachSoloHover(target, path),
    });
  }

  private toggleNodeVisibility(node: Node, options: { focus?: boolean; isolate?: boolean } = {}): void {
    if (options.isolate) {
      this.toggleIsolatedVisibility(node, options);
      return;
    }
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

  private toggleIsolatedVisibility(node: Node, options: { focus?: boolean } = {}): void {
    const isolatedHiddenNodeIds = hiddenNodeIdsForIsolatedGraphNode(this.sdf?.node ?? null, node);
    if (graphNodeIdSetsEqual(this.hiddenNodeIds, isolatedHiddenNodeIds)) {
      this.showAllNodes(options);
      return;
    }

    this.hiddenNodeIds.clear();
    for (const nodeId of isolatedHiddenNodeIds) this.hiddenNodeIds.add(nodeId);
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
    const selectedId = this.selected.id;
    const selectedTarget = () => this.tree.querySelector<HTMLElement>(`.graph-node[data-node-id="${selectedId}"]`);
    const focusTarget = () => {
      const target = selectedTarget();
      if (!target) return;
      this.focusGraphNodeTarget(target);
    };
    if (focus) focusTarget();
    window.requestAnimationFrame(() => {
      const target = selectedTarget();
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (!focus) return;
      focusTarget();
      window.requestAnimationFrame(focusTarget);
      window.setTimeout(focusTarget, 0);
      window.setTimeout(focusTarget, 40);
      window.setTimeout(focusTarget, 100);
    });
  }

  private focusGraphNodeTarget(target: HTMLElement): void {
    target.focus({ preventScroll: true });
    if (document.activeElement === target) return;
    this.tree.setAttribute("aria-activedescendant", target.id);
    this.tree.focus({ preventScroll: true });
  }

  private syncTreeActiveDescendant(): void {
    if (!this.selected) {
      this.tree.removeAttribute("aria-activedescendant");
      return;
    }
    const target = this.tree.querySelector<HTMLElement>(`.graph-node[data-node-id="${this.selected.id}"]`);
    if (!target) {
      this.tree.removeAttribute("aria-activedescendant");
      return;
    }
    this.tree.setAttribute("aria-activedescendant", target.id);
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
    const path = graphNodePath(this.sdf?.node ?? null, node.id);
    return path.length > 1 ? path[path.length - 2] : null;
  }

  private firstVisibleChild(node: Node): Node | null {
    if (!this.sdf) return null;
    const model = buildGraphModel(this.sdf.node, this.filter);
    return node.children.find((child) => childMatchesFilter(child.node, model.visibleNodeIds))?.node ?? null;
  }

  private nodeKeyboardShortcuts(node: Node): string {
    const shortcuts = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (this.sdf?.node.id !== node.id) shortcuts.push("V");
    shortcuts.push("Shift+V");
    if (this.soloPreviewForNode(node)) shortcuts.push("I");
    if (this.sourceLinkForNode(node.id)) shortcuts.push("C");
    return shortcuts.join(" ");
  }

  private attachSoloHover(target: Element, path: Node[]): void {
    const sourceLink = this.sourceLinkForNode(path.at(-1)?.id ?? -1);
    target.addEventListener("pointerenter", (event) => {
      this.pointerHoverPath = path;
      this.updateHover(path, event);
      if (sourceLink) this.options.onSourceHover(sourceLink);
    });
    target.addEventListener("pointermove", (event) => {
      this.pointerHoverPath = path;
      this.updateHover(path, event);
    });
    target.addEventListener("pointerleave", (event) => {
      if (sourceLink && !containsEventTarget(target, relatedEventTarget(event))) {
        this.options.onSourceHover(null);
      }
      this.clearHover();
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
      }
    });
  }

  private updateHover(path: Node[], event: Event): void {
    this.emitHover(path, event instanceof PointerEvent && event.shiftKey);
  }

  private refreshPointerHover(shiftKey: boolean): void {
    if (!this.pointerHoverPath) return;
    this.emitHover(this.pointerHoverPath, shiftKey);
  }

  private emitHover(path: Node[], shiftKey: boolean): void {
    const target = path.at(-1) ?? null;
    const targetId = target?.id ?? null;
    const previousFocusHoverNodeId = this.focusHoverNodeId;
    const nextFocusHoverNodeId = shiftKey ? targetId : null;
    const hoverChanged = (this.hovered?.id ?? null) !== targetId;
    this.focusHoverNodeId = nextFocusHoverNodeId;
    this.setHoveredNodeById(target?.id ?? null);
    if (!hoverChanged) this.syncFocusHoverClass(previousFocusHoverNodeId, nextFocusHoverNodeId);
    this.options.onHover(target, { shiftKey });
  }

  private clearHover(): void {
    this.pointerHoverPath = null;
    const previousFocusHoverNodeId = this.focusHoverNodeId;
    this.focusHoverNodeId = null;
    this.setHoveredNodeById(null);
    this.syncFocusHoverClass(previousFocusHoverNodeId, null);
    this.options.onHover(null, { shiftKey: false });
  }

  private syncFocusHoverClass(previousId: number | null, nextId: number | null): void {
    if (previousId === nextId) return;
    const ids = new Set<number>();
    if (previousId != null) ids.add(previousId);
    if (nextId != null) ids.add(nextId);
    for (const id of ids) {
      const isFocused = id === nextId;
      for (const element of this.root.querySelectorAll<HTMLElement | SVGElement>(`[data-node-id="${id}"]`)) {
        if (element.classList.contains("graph-node") || element.classList.contains("graph-map-node")) {
          element.classList.toggle("focus-peek", isFocused);
        }
      }
    }
  }

  private toggleLockedSolo(node: Node, options: { focus?: boolean } = {}): void {
    const preview = this.soloPreviewForNode(node);
    if (!preview) return;

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
    this.options.onSolo(null);
  }

  private soloPreviewForNode(node: Node): SoloPreview | null {
    return buildSoloPreview(graphNodePath(this.sdf?.node ?? null, node.id));
  }

  private renderParams(): void {
    this.paramPanel.render();
  }

  private sourceLinkForNode(nodeId: number): GraphSourceLink | null {
    return this.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.label === "call" && link.end > link.start;
    }) ?? this.sourceLinks.find((link) => {
      return link.nodeId === nodeId && link.end > link.start;
    }) ?? null;
  }
}

function containsEventTarget(parent: Element, target: EventTarget | null): boolean {
  return target instanceof globalThis.Node && parent.contains(target);
}

function relatedEventTarget(event: Event): EventTarget | null {
  return event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
}
