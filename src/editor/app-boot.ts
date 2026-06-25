import type { PreviewViewportController } from "../preview/preview-viewport-controller";
import { hasWebGPU } from "../gpu/webgpu";
import type { BrowserSessionController } from "./browser-session-controller";
import type { CodeEditor } from "./code-editor";
import type { GraphInteractionController } from "./graph-interaction-controller";
import { GraphInspector } from "./graph-inspector";
import type { SourceCompileController } from "./source-compile-controller";
import type { SourceEditorController } from "./source-editor-controller";
import type { SourceWorkspaceActions } from "./source-workspace-actions";
import type { SourceWorkspaceSession } from "./source-workspace-session";

export interface AppBootElements {
  gpuBadge: HTMLElement;
  overlay: HTMLElement;
  graphInspectorRoot: HTMLElement;
  codeEditorRoot: HTMLElement;
}

export interface AppBootOptions {
  elements: AppBootElements;
  healthCheckMode: boolean;
  initialSource(): string;
  previewViewport: PreviewViewportController;
  sourceCompile: SourceCompileController;
  sourceEditor: SourceEditorController;
  sourceWorkspace: SourceWorkspaceSession;
  sourceWorkspaceActions: SourceWorkspaceActions;
  browserSession: BrowserSessionController;
  graphInteraction(): GraphInteractionController | null;
  updateSaveState(): void;
  setGraphInspector(inspector: GraphInspector): void;
  setCodeEditor(editor: CodeEditor): void;
}

export async function bootApp(options: AppBootOptions): Promise<void> {
  const { elements } = options;
  if (!hasWebGPU()) {
    elements.gpuBadge.textContent = "WebGL preview";
    elements.gpuBadge.classList.add("warn");
  } else {
    elements.gpuBadge.textContent = "WebGL + WebGPU";
    elements.gpuBadge.classList.add("ok");
  }

  try {
    options.previewViewport.initialize();
    options.setGraphInspector(new GraphInspector(elements.graphInspectorRoot, {
      onSelect: (node) => options.graphInteraction()?.selectNode(node),
      onHover: (node, hoverOptions) => options.graphInteraction()?.handleGraphHover(node, hoverOptions),
      onEdit: (edit) => options.graphInteraction()?.handleGraphEdit(edit),
      onSolo: (preview) => options.graphInteraction()?.handleSoloPreview(preview),
      onRevealSource: (link) => options.graphInteraction()?.revealGraphSource(link),
      onSourceHover: (link) => options.graphInteraction()?.handleGraphSourceHover(link),
      onVisibilityChange: (hiddenIds) => options.graphInteraction()?.handleGraphVisibilityChange(hiddenIds),
    }));
    options.sourceCompile.compile({ status: "Ready", statusState: "idle", invalidateMesh: false });
    await options.previewViewport.renderCurrent();

    const { createCodeEditor } = await import("./code-editor");
    options.setCodeEditor(createCodeEditor(
      elements.codeEditorRoot,
      options.initialSource(),
      options.sourceEditor.scheduleCompile,
      (link, selectOptions) => options.graphInteraction()?.handleSourceLinkSelect(link, selectOptions),
      (link, value, valueOptions) => options.graphInteraction()?.handleSourceLinkValueChange(link, value, valueOptions),
      (link, hoverOptions) => options.graphInteraction()?.handleSourceLinkHover(link, hoverOptions),
      (link) => options.graphInteraction()?.handleSourceLinkCursor(link),
      options.sourceEditor.prettifyCurrentSource,
    ));

    options.sourceEditor.applyGraphHintsToEditor();
    if (options.healthCheckMode || !options.sourceWorkspaceActions.restoreDraft()) {
      options.sourceCompile.refreshCurrentGraph();
    }
    options.sourceWorkspace.setDraftPersistenceEnabled(!options.healthCheckMode);
    options.updateSaveState();
    options.browserSession.connect();
  } catch (error) {
    elements.gpuBadge.textContent = "Preview error";
    elements.gpuBadge.classList.add("warn");
    elements.overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}
