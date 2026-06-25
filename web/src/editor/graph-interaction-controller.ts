import type { Node, SDF3 } from "../core/nodes";
import type { RenderHighlight, PreviewViewportController } from "../preview/preview-viewport-controller";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceEdit, type GraphSourceLink } from "./clean-source-patch";
import type { CodeEditor, SourceLinkHoverOptions, SourceLinkSelectOptions, SourceLinkValueChangeOptions } from "./code-editor";
import type { EditorViewController, EditorViewSelectedTarget } from "./editor-view-controller";
import type { GraphHistoryController, GraphHistoryEntry } from "./graph-history-controls";
import type { GraphHoverOptions, GraphInspector, GraphParamEdit } from "./graph-inspector";
import {
  graphNodeSourceIdentityForNode,
  graphSourceLinkIdentityForLink,
  sourceLinkForGraphNodeIdentity,
  sourceLinkForGraphSourceLinkIdentity,
  type GraphNodeSourceIdentity,
  type GraphSourceLinkIdentity,
} from "./graph-source-identity";
import {
  hiddenNodeIdsFromKeys,
  hiddenNodeKeysForGraph,
} from "./preview-profile";
import type { SoloPreview } from "./solo-preview";
import {
  graphNodeLabel,
  sourceLinkForGraphEdit,
  sourceLinkForNodeId,
  sourceLinkLabel,
  sourceLinksEqual,
} from "./source-link-matching";
import type { EditorStatusState } from "./source-editor-controller";
import { buildVisibleSdf } from "./visible-sdf";

export interface GraphSelectionIdentity {
  source: GraphSourceLinkIdentity | null;
  node: GraphNodeSourceIdentity | null;
}

export interface GraphInteractionDiagnosticsState {
  sourceLinks: number;
  selectedNode: string | null;
  selectedSourceLink: string | null;
  hiddenNodes: number;
}

export interface GraphInteractionPreviewState {
  visibleSdf: SDF3 | null;
  renderSdf: SDF3 | null;
  shaderHighlight: RenderHighlight;
  meshHighlight: RenderHighlight;
  soloOverlayText: string;
  focusOverlayText: string;
  hasSoloPreview: boolean;
}

export interface GraphInteractionControllerOptions {
  codeEditor(): CodeEditor | null;
  graphInspector(): GraphInspector | null;
  activeSdf(): SDF3 | null;
  editorView: EditorViewController;
  previewViewport: PreviewViewportController;
  graphHistory: GraphHistoryController;
  updateSaveState(): void;
  setEditorStatus(message: string, state: EditorStatusState): void;
  afterBrowserFrame(callback: () => void): void;
}

export interface GraphInteractionController {
  captureSelectionIdentity(): GraphSelectionIdentity;
  applyCompiledGraph(options: {
    source: string;
    sdf: SDF3;
    sourceLinks: readonly GraphSourceLink[];
    previousSelection: GraphSelectionIdentity;
  }): void;
  handleCompileError(): void;
  clearSourceLinks(): void;
  preserveHiddenNodeKeys(): void;
  clearPendingHiddenNodeKeys(): void;
  applyPendingHiddenNodeKeys(keys: readonly string[]): void;
  resetLoadedSourceState(): void;
  hiddenNodeKeysForCurrentGraph(): string[];
  sourceLinkForEntry(entry: GraphHistoryEntry): GraphSourceLink | null;
  selectedEntry(entry: GraphHistoryEntry): boolean;
  clearGraphHistoryHoverKey(): void;
  readSelectedEditorTarget(): EditorViewSelectedTarget;
  readDiagnosticsState(): GraphInteractionDiagnosticsState;
  readPreviewState(): GraphInteractionPreviewState;
  selectNode(node: Node | null): void;
  handleGraphHover(node: Node | null, options: GraphHoverOptions): void;
  handleGraphEdit(edit: GraphParamEdit): void;
  handleSoloPreview(preview: SoloPreview | null): void;
  handleGraphVisibilityChange(hiddenIds: readonly number[]): void;
  revealGraphSource(link: GraphSourceLink): void;
  handleGraphSourceHover(link: GraphSourceLink | null): void;
  handleSourceLinkSelect(link: GraphSourceLink, options?: SourceLinkSelectOptions): void;
  handleSourceLinkCursor(link: GraphSourceLink | null): void;
  handleSourceLinkValueChange(link: GraphSourceLink, nextValue: number, options?: SourceLinkValueChangeOptions): void;
  handleSourceLinkHover(link: GraphSourceLink | null, options: SourceLinkHoverOptions): void;
  applyGraphMutationStatus(message: string, edit?: GraphSourceEdit, value?: unknown): void;
  syncCodeFromGraphEdit(edit: GraphSourceEdit, value: unknown): boolean;
  hoverGraphHistoryEntry(entry: GraphHistoryEntry, options: { shiftKey: boolean }): void;
  clearGraphHistoryEntryHover(): void;
  selectGraphHistoryEntry(entry: GraphHistoryEntry, options?: { revealSource?: boolean }): void;
}

export function createGraphInteractionController(
  options: GraphInteractionControllerOptions,
): GraphInteractionController {
  return new GraphInteractionControllerImpl(options);
}

class GraphInteractionControllerImpl implements GraphInteractionController {
  private selectedNode: Node | null = null;
  private hoveredNode: Node | null = null;
  private focusPreview: SoloPreview | null = null;
  private soloPreview: SoloPreview | null = null;
  private hiddenNodeIds = new Set<number>();
  private currentSourceLinks: readonly GraphSourceLink[] = [];
  private selectedSourceLink: GraphSourceLink | null = null;
  private pendingHiddenNodeKeys: readonly string[] = [];
  private graphHistoryHoverKey: string | null = null;

  constructor(private readonly options: GraphInteractionControllerOptions) {}

  captureSelectionIdentity(): GraphSelectionIdentity {
    const activeSdf = this.options.activeSdf();
    return {
      source: this.selectedSourceLink
        ? graphSourceLinkIdentityForLink(this.currentSourceLinks, this.selectedSourceLink)
        : null,
      node: this.selectedNode && activeSdf?.node.id !== this.selectedNode.id
        ? graphNodeSourceIdentityForNode(this.currentSourceLinks, this.selectedNode.id)
        : null,
    };
  }

  applyCompiledGraph(options: {
    source: string;
    sdf: SDF3;
    sourceLinks: readonly GraphSourceLink[];
    previousSelection: GraphSelectionIdentity;
  }): void {
    const restoredHiddenNodeIds = hiddenNodeIdsFromKeys(
      this.pendingHiddenNodeKeys,
      options.sourceLinks,
      options.sdf,
    );
    this.pendingHiddenNodeKeys = [];
    this.soloPreview = null;
    this.focusPreview = null;
    this.hiddenNodeIds = new Set(restoredHiddenNodeIds);
    this.currentSourceLinks = options.sourceLinks;
    this.options.graphInspector()?.setSdf(options.sdf, restoredHiddenNodeIds);
    this.options.codeEditor()?.setError(null);
    this.refreshSourceLinks(options.source, options.sdf, options.sourceLinks);
    this.restoreSelectedGraphSelection(options.previousSelection, options.sourceLinks);
    this.options.graphHistory.clear();
  }

  handleCompileError(): void {
    this.options.codeEditor()?.setSourceLinks([]);
    this.options.graphInspector()?.setSourceLinks([]);
    this.currentSourceLinks = [];
    this.selectedSourceLink = null;
  }

  clearSourceLinks(): void {
    this.options.codeEditor()?.setSourceLinks([]);
    this.options.graphInspector()?.setSourceLinks([]);
  }

  preserveHiddenNodeKeys(): void {
    this.pendingHiddenNodeKeys = this.hiddenNodeKeysForCurrentGraph();
  }

  clearPendingHiddenNodeKeys(): void {
    this.pendingHiddenNodeKeys = [];
  }

  applyPendingHiddenNodeKeys(keys: readonly string[]): void {
    this.pendingHiddenNodeKeys = keys;
  }

  resetLoadedSourceState(): void {
    this.selectedNode = null;
    this.selectedSourceLink = null;
    this.hoveredNode = null;
    this.focusPreview = null;
    this.hiddenNodeIds = new Set();
  }

  hiddenNodeKeysForCurrentGraph(): string[] {
    return hiddenNodeKeysForGraph(
      this.hiddenNodeIds,
      this.pendingHiddenNodeKeys,
      this.currentSourceLinks,
    );
  }

  sourceLinkForEntry(entry: GraphHistoryEntry): GraphSourceLink | null {
    return sourceLinkForGraphEdit(this.currentSourceLinks, entry);
  }

  selectedEntry(entry: GraphHistoryEntry): boolean {
    return sourceLinksEqual(this.sourceLinkForEntry(entry), this.selectedSourceLink);
  }

  clearGraphHistoryHoverKey(): void {
    this.graphHistoryHoverKey = null;
  }

  readSelectedEditorTarget(): EditorViewSelectedTarget {
    const link = this.selectedSourceLink ?? (
      this.selectedNode ? sourceLinkForNodeId(this.currentSourceLinks, this.selectedNode.id) : null
    );
    const label = this.selectedSourceLink
      ? sourceLinkLabel(this.selectedSourceLink)
      : this.selectedNode
        ? graphNodeLabel(this.selectedNode)
        : "";
    return { label, sourceLink: link, graphNode: this.selectedNode };
  }

  readDiagnosticsState(): GraphInteractionDiagnosticsState {
    return {
      sourceLinks: this.currentSourceLinks.length,
      selectedNode: this.selectedNode ? `${this.selectedNode.kind} #${this.selectedNode.id}` : null,
      selectedSourceLink: this.selectedSourceLink
        ? sourceLinkLabel(this.selectedSourceLink)
        : null,
      hiddenNodes: this.hiddenNodeIds.size,
    };
  }

  readPreviewState(): GraphInteractionPreviewState {
    const visibleSdf = this.visibleActiveSdf();
    return {
      visibleSdf,
      renderSdf: this.soloPreview?.sdf ?? visibleSdf,
      shaderHighlight: this.highlightForRender(this.soloPreview),
      meshHighlight: this.highlightForRender(null),
      soloOverlayText: this.soloPreview ? previewOverlayText("Solo", this.soloPreview) : "",
      focusOverlayText: this.focusPreview ? previewOverlayText("Focus", this.focusPreview) : "",
      hasSoloPreview: Boolean(this.soloPreview),
    };
  }

  selectNode(node: Node | null): void {
    this.selectedNode = node;
    const sourceLink = node ? sourceLinkForNodeId(this.currentSourceLinks, node.id) : null;
    this.setSelectedSourceLink(sourceLink);
    this.options.codeEditor()?.setFocusedNode(node?.id ?? null, {
      reveal: this.options.editorView.view === "code",
    });
    if (node && this.options.activeSdf()) {
      this.options.setEditorStatus(`${node.kind} #${node.id}`, "ok");
      this.options.previewViewport.scheduleActivePreview(0);
    }
  }

  handleGraphHover(node: Node | null, options: GraphHoverOptions): void {
    const before = this.previewHoverSignature();
    this.hoveredNode = node;
    if (!node) {
      this.focusPreview = null;
      if (this.soloPreview) this.handleSoloPreview(null);
      else this.schedulePreviewIfHoverChanged(before);
      this.options.codeEditor()?.setFocusedNode(this.selectedNode?.id ?? null);
      return;
    }

    this.options.codeEditor()?.setFocusedNode(node.id);
    if (options.shiftKey && this.isHighlightableNode(node)) {
      this.focusPreview = this.options.graphInspector()?.buildSoloPreviewForNodeId(node.id) ?? null;
      this.schedulePreviewIfHoverChanged(before);
      return;
    }

    this.focusPreview = null;
    if (this.soloPreview) this.handleSoloPreview(null);
    else this.schedulePreviewIfHoverChanged(before);
  }

  handleGraphEdit(edit: GraphParamEdit): void {
    if (!this.options.activeSdf()) return;
    this.focusPreview = null;
    this.soloPreview = null;
    this.options.graphHistory.record(edit);
    this.applyGraphMutationStatus(`Edited ${edit.nodeKind} ${edit.label}`, edit, edit.nextValue);
  }

  handleSoloPreview(preview: SoloPreview | null): void {
    this.focusPreview = null;
    this.soloPreview = preview;
    if (preview) {
      this.options.previewViewport.showSoloPreview();
      return;
    }

    this.options.previewViewport.clearSoloPreview();
  }

  handleGraphVisibilityChange(hiddenIds: readonly number[]): void {
    this.hiddenNodeIds = new Set(hiddenIds);
    this.focusPreview = null;
    this.soloPreview = null;
    this.options.updateSaveState();
    this.options.previewViewport.invalidateMeshForActiveSdf();
    this.options.previewViewport.schedulePreview(0);
  }

  revealGraphSource(link: GraphSourceLink): void {
    this.options.editorView.setView("code");
    this.options.codeEditor()?.setFocusedNode(link.nodeId);
    this.setSelectedSourceLink(link);
    this.options.afterBrowserFrame(() => {
      this.options.codeEditor()?.revealSourceLink(link);
    });
    this.options.setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
  }

  handleGraphSourceHover(link: GraphSourceLink | null): void {
    this.options.codeEditor()?.markHoveredSourceLink(link);
  }

  handleSourceLinkSelect(link: GraphSourceLink, options: SourceLinkSelectOptions = {}): void {
    this.handleSourceLinkCursor(link);
    if (!options.revealGraph) return;
    this.options.editorView.setView("graph");
    window.setTimeout(() => this.options.graphInspector()?.revealSelected({ focus: true }), 0);
  }

  handleSourceLinkCursor(link: GraphSourceLink | null): void {
    if (!link) {
      this.setSelectedSourceLink(null, { markCode: false });
      return;
    }
    const node = this.options.graphInspector()?.selectNodeById(link.nodeId);
    if (!node) return;
    this.setSelectedSourceLink(link, { markCode: false });
    this.options.setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
    this.options.previewViewport.scheduleActivePreview(0);
  }

  handleSourceLinkValueChange(
    link: GraphSourceLink,
    nextValue: number,
    options: SourceLinkValueChangeOptions = {},
  ): void {
    const graphInspector = this.options.graphInspector();
    if (!graphInspector) return;
    const previousValue = graphInspector.getParamValue(link.nodeId, link.path);
    if (typeof previousValue !== "number" || previousValue === nextValue) return;
    const node = graphInspector.setParamValue(link.nodeId, link.path, nextValue);
    if (!node) return;
    this.handleGraphEdit({
      node,
      nodeId: node.id,
      nodeKind: node.kind,
      path: [...link.path],
      label: link.label,
      previousValue,
      nextValue,
      ...(options.editSessionId ? { editSessionId: options.editSessionId } : {}),
    });
  }

  handleSourceLinkHover(link: GraphSourceLink | null, options: SourceLinkHoverOptions): void {
    const graphInspector = this.options.graphInspector();
    if (!graphInspector) return;
    const before = this.previewHoverSignature();
    if (!link) {
      this.hoveredNode = null;
      this.focusPreview = null;
      graphInspector.setHoveredSourceLink(null);
      graphInspector.setHoveredNodeById(null);
      graphInspector.setFocusHoveredNodeById(null);
      if (this.soloPreview) this.handleSoloPreview(null);
      else this.schedulePreviewIfHoverChanged(before);
      const selected = graphInspector.getSelected();
      this.options.codeEditor()?.setFocusedNode(selected?.id ?? null);
      return;
    }

    graphInspector.setHoveredSourceLink(link);
    const node = graphInspector.setHoveredNodeById(link.nodeId);
    this.hoveredNode = node;
    if (!node) {
      graphInspector.setFocusHoveredNodeById(null);
      return;
    }
    this.options.codeEditor()?.setFocusedNode(node.id);

    if (options.shiftKey && this.isHighlightableNode(node)) {
      graphInspector.setFocusHoveredNodeById(node.id);
      this.focusPreview = graphInspector.buildSoloPreviewForNodeId(link.nodeId);
      this.schedulePreviewIfHoverChanged(before);
      return;
    }

    graphInspector.setFocusHoveredNodeById(null);
    this.focusPreview = null;
    if (this.soloPreview) this.handleSoloPreview(null);
    else this.schedulePreviewIfHoverChanged(before);
  }

  applyGraphMutationStatus(message: string, edit?: GraphSourceEdit, value?: unknown): void {
    const synced = edit ? this.syncCodeFromGraphEdit(edit, value) : true;
    this.options.setEditorStatus(synced ? message : `${message} (preview only)`, synced ? "ok" : "pending");
    this.options.previewViewport.invalidateMeshForActiveSdf();
    this.options.previewViewport.schedulePreview(0);
  }

  syncCodeFromGraphEdit(edit: GraphSourceEdit, value: unknown): boolean {
    const activeSdf = this.options.activeSdf();
    const codeEditor = this.options.codeEditor();
    if (!activeSdf || !codeEditor) return false;
    const nextSource = patchGraphEditSource(codeEditor.getValue(), activeSdf, edit, value);
    if (!nextSource) return false;
    const nextSourceLinks = findGraphSourceLinks(nextSource, activeSdf);
    const editedLink = sourceLinkForGraphEdit(nextSourceLinks, edit);
    codeEditor.setValue(nextSource);
    codeEditor.setError(null);
    this.options.updateSaveState();
    this.refreshSourceLinks(nextSource, activeSdf, nextSourceLinks);
    if (editedLink) {
      this.setSelectedSourceLink(editedLink);
    }
    codeEditor.markEditedSourceLink(editedLink, { reveal: this.options.editorView.view === "code" });
    return true;
  }

  hoverGraphHistoryEntry(entry: GraphHistoryEntry, options: { shiftKey: boolean }): void {
    const graphInspector = this.options.graphInspector();
    if (!graphInspector) return;
    const focus = options.shiftKey;
    const hoverKey = `${entry.id}:${focus}`;
    if (hoverKey === this.graphHistoryHoverKey) return;
    this.graphHistoryHoverKey = hoverKey;
    const before = this.previewHoverSignature();
    const node = graphInspector.setHoveredNodeById(entry.nodeId);
    const sourceLink = sourceLinkForGraphEdit(this.currentSourceLinks, entry);
    this.hoveredNode = node;
    graphInspector.setHoveredSourceLink(sourceLink);
    this.options.codeEditor()?.markHoveredSourceLink(sourceLink);
    if (!node) {
      graphInspector.setFocusHoveredNodeById(null);
      this.focusPreview = null;
      this.schedulePreviewIfHoverChanged(before);
      return;
    }

    this.options.codeEditor()?.setFocusedNode(node.id);
    if (focus && this.isHighlightableNode(node)) {
      graphInspector.setFocusHoveredNodeById(node.id);
      this.focusPreview = graphInspector.buildSoloPreviewForNodeId(node.id);
    } else {
      graphInspector.setFocusHoveredNodeById(null);
      this.focusPreview = null;
    }
    this.schedulePreviewIfHoverChanged(before);
  }

  clearGraphHistoryEntryHover(): void {
    const graphInspector = this.options.graphInspector();
    if (!graphInspector) return;
    this.graphHistoryHoverKey = null;
    const before = this.previewHoverSignature();
    this.hoveredNode = null;
    this.focusPreview = null;
    graphInspector.setHoveredNodeById(null);
    graphInspector.setFocusHoveredNodeById(null);
    graphInspector.setHoveredSourceLink(null);
    this.options.codeEditor()?.markHoveredSourceLink(null);
    this.options.codeEditor()?.setFocusedNode(this.selectedNode?.id ?? null);
    this.schedulePreviewIfHoverChanged(before);
  }

  selectGraphHistoryEntry(entry: GraphHistoryEntry, options: { revealSource?: boolean } = {}): void {
    const node = this.options.graphInspector()?.selectNodeById(entry.nodeId);
    if (!node) return;
    const sourceLink = sourceLinkForGraphEdit(this.currentSourceLinks, entry);
    if (sourceLink && options.revealSource) {
      this.revealGraphSource(sourceLink);
      this.options.previewViewport.schedulePreview(0);
      return;
    }
    this.options.editorView.setView("graph");
    if (sourceLink) this.setSelectedSourceLink(sourceLink);
    this.options.setEditorStatus(`${entry.nodeKind} ${entry.label}`, "ok");
    this.options.afterBrowserFrame(() => this.options.graphInspector()?.revealSelected({ focus: true }));
    this.options.previewViewport.schedulePreview(0);
  }

  private refreshSourceLinks(
    source = this.options.codeEditor()?.getValue(),
    sdf = this.options.activeSdf(),
    links: readonly GraphSourceLink[] = source && sdf ? findGraphSourceLinks(source, sdf) : [],
  ): void {
    const codeEditor = this.options.codeEditor();
    if (!codeEditor || !source || !sdf) return;
    this.currentSourceLinks = links;
    codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));
    this.options.graphInspector()?.setSourceLinks(links);
    codeEditor.setFocusedNode(this.sourceFocusNodeId());
  }

  private restoreSelectedGraphSelection(
    selection: GraphSelectionIdentity,
    sourceLinks: readonly GraphSourceLink[],
  ): void {
    const sourceLink = selection.source
      ? sourceLinkForGraphSourceLinkIdentity(sourceLinks, selection.source)
      : null;
    if (sourceLink && this.selectRestoredSourceLink(sourceLink)) return;
    this.restoreSelectedGraphNode(selection.node, sourceLinks);
  }

  private restoreSelectedGraphNode(
    identity: GraphNodeSourceIdentity | null,
    sourceLinks: readonly GraphSourceLink[],
  ): void {
    if (!identity || !this.options.graphInspector()) return;
    const link = sourceLinkForGraphNodeIdentity(sourceLinks, identity);
    if (!link) return;
    this.selectRestoredSourceLink(link);
  }

  private selectRestoredSourceLink(link: GraphSourceLink): boolean {
    const graphInspector = this.options.graphInspector();
    if (!graphInspector) return false;
    const node = graphInspector.selectNodeById(link.nodeId);
    if (!node) return false;
    this.setSelectedSourceLink(link);
    return true;
  }

  private setSelectedSourceLink(
    link: GraphSourceLink | null,
    options: { markCode?: boolean } = {},
  ): void {
    this.selectedSourceLink = link;
    this.options.graphInspector()?.setSelectedSourceLink(link);
    if (options.markCode !== false) this.options.codeEditor()?.markSelectedSourceLink(link);
    this.options.editorView.updateSelectionFocusButton();
    this.options.graphHistory.refresh();
  }

  private sourceFocusNodeId(): number | null {
    const node = this.hoveredNode ?? this.selectedNode;
    return node && !this.isActiveRootNode(node) ? node.id : null;
  }

  private visibleActiveSdf(): SDF3 | null {
    const activeSdf = this.options.activeSdf();
    return activeSdf ? buildVisibleSdf(activeSdf, this.hiddenNodeIds) : null;
  }

  private highlightForRender(preview: SoloPreview | null): RenderHighlight {
    if (preview?.node) return { node: this.isHighlightableNode(preview.node) ? preview.node : null, mode: "mark" };
    if (this.focusPreview?.sdf.node && this.isHighlightableNode(this.focusPreview.node)) {
      return { node: this.focusPreview.sdf.node, mode: "focus" };
    }
    if (this.hoveredNode && this.isHighlightableNode(this.hoveredNode)) return { node: this.hoveredNode, mode: "mark" };
    if (this.selectedNode && this.isHighlightableNode(this.selectedNode)) return { node: this.selectedNode, mode: "mark" };
    return { node: null, mode: "mark" };
  }

  private isActiveRootNode(node: Node): boolean {
    return this.options.activeSdf()?.node.id === node.id;
  }

  private isHighlightableNode(node: Node): boolean {
    return !this.isActiveRootNode(node) && this.isNodeEffectivelyVisible(node.id);
  }

  private isNodeEffectivelyVisible(nodeId: number): boolean {
    const activeSdf = this.options.activeSdf();
    if (!activeSdf) return false;
    let visible = false;

    const visit = (node: Node, inheritedHidden: boolean) => {
      if (visible) return;
      const hidden = inheritedHidden || this.hiddenNodeIds.has(node.id);
      if (node.id === nodeId && !hidden) {
        visible = true;
        return;
      }
      for (const child of node.children) visit(child.node, hidden);
    };

    visit(activeSdf.node, false);
    return visible;
  }

  private previewHoverSignature(): string {
    return [
      this.hoveredNode?.id ?? "",
      this.focusPreview?.key ?? "",
      this.soloPreview?.key ?? "",
    ].join(":");
  }

  private schedulePreviewIfHoverChanged(before: string): void {
    if (this.previewHoverSignature() !== before) this.options.previewViewport.scheduleActivePreview(0);
  }
}

function previewOverlayText(prefix: "Focus" | "Solo", preview: SoloPreview): string {
  return `${prefix}: ${preview.label}${preview.preservedWrappers ? ` (${preview.preservedWrappers} context)` : ""}`;
}
