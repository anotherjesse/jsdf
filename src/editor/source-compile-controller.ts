import type { SDF3 } from "../core/nodes";
import type { PreviewViewportController } from "../preview/preview-viewport-controller";
import { findGraphSourceLinks } from "./clean-source-patch";
import type { CodeEditor } from "./code-editor";
import { evaluateSource } from "./evaluate-source";
import type { GraphInteractionController, GraphSelectionIdentity } from "./graph-interaction-controller";
import { sourceDiagnosticFromError } from "./source-diagnostics";
import type { EditorStatusState, SourceCompileOptions } from "./source-editor-controller";

export interface SourceCompileControllerOptions {
  overlay: HTMLElement;
  codeEditor(): CodeEditor | null;
  fallbackSource(): string;
  graphInteraction(): GraphInteractionController | null;
  previewViewport: PreviewViewportController;
  updateSaveState(): void;
  setEditorStatus(message: string, state: EditorStatusState): void;
}

export interface SourceCompileController {
  readonly activeSdf: SDF3 | null;
  readonly sourceValid: boolean;
  currentSource(): string;
  compile(options?: SourceCompileOptions): boolean;
  refreshCurrentGraph(options?: { previousSelection?: GraphSelectionIdentity }): boolean;
}

export function createSourceCompileController(
  options: SourceCompileControllerOptions,
): SourceCompileController {
  let activeSdf: SDF3 | null = null;
  let sourceValid = true;

  function currentSource(): string {
    return options.codeEditor()?.getValue() ?? options.fallbackSource();
  }

  function compile(
    compileOptions: SourceCompileOptions = { status: "Compiled" },
  ): boolean {
    const source = currentSource();
    const previousSelection = options.graphInteraction()?.captureSelectionIdentity() ?? { source: null, node: null };
    try {
      const { sdf } = evaluateSource(source);
      const sourceLinks = findGraphSourceLinks(source, sdf);
      sourceValid = true;
      activeSdf = sdf;
      options.graphInteraction()?.applyCompiledGraph({
        source,
        sdf,
        sourceLinks,
        previousSelection,
      });
      options.setEditorStatus(compileOptions.status, compileOptions.statusState ?? "ok");
      if (compileOptions.invalidateMesh !== false) options.previewViewport.invalidateMeshForActiveSdf();
      options.updateSaveState();
      options.previewViewport.schedulePreview(0);
      return true;
    } catch (error) {
      const diagnostic = sourceDiagnosticFromError(error, source);
      options.codeEditor()?.setError(diagnostic);
      options.graphInteraction()?.handleCompileError();
      sourceValid = false;
      options.setEditorStatus(diagnostic.message, "error");
      options.overlay.textContent = `Code error: ${diagnostic.message}`;
      return false;
    }
  }

  function refreshCurrentGraph(
    refreshOptions: { previousSelection?: GraphSelectionIdentity } = {},
  ): boolean {
    if (!activeSdf) return false;
    const source = currentSource();
    options.graphInteraction()?.applyCompiledGraph({
      source,
      sdf: activeSdf,
      sourceLinks: findGraphSourceLinks(source, activeSdf),
      previousSelection: refreshOptions.previousSelection ?? { source: null, node: null },
    });
    return true;
  }

  return {
    get activeSdf() {
      return activeSdf;
    },
    get sourceValid() {
      return sourceValid;
    },
    currentSource,
    compile,
    refreshCurrentGraph,
  };
}
