import type { SDF3 } from "../core/nodes";
import { estimateBounds, paddedBounds, type Bounds3 } from "../mesh/bounds";
import { createBoundsEditor, type BoundsEditor } from "./bounds-editor";
import { boundsForExample, cloneBounds } from "./preview-profile";
import type { EditorStatusState } from "./source-editor-controller";

export interface PreviewBoundsElements {
  root: HTMLElement;
  fitButton: HTMLButtonElement;
  overlay: HTMLElement;
}

export interface PreviewBoundsControllerOptions {
  elements: PreviewBoundsElements;
  initialBounds: Bounds3;
  readActiveSdf(): SDF3 | null;
  updateSaveState(): void;
  setEditorStatus(message: string, state: EditorStatusState): void;
  invalidatePreview(): void;
}

export interface PreviewBoundsController {
  readonly bounds: Bounds3;
  readonly valid: boolean;
  applyExampleBounds(id: string): void;
  applyProfileBounds(bounds: Bounds3): void;
  fitCurrentSdf(): void;
}

export function createPreviewBoundsController(
  options: PreviewBoundsControllerOptions,
): PreviewBoundsController {
  return new PreviewBoundsControllerImpl(options);
}

class PreviewBoundsControllerImpl implements PreviewBoundsController {
  private currentBounds: Bounds3;
  private boundsAreValid = true;
  private readonly editor: BoundsEditor;

  constructor(private readonly options: PreviewBoundsControllerOptions) {
    this.currentBounds = cloneBounds(options.initialBounds);
    this.editor = createBoundsEditor(options.elements.root, this.currentBounds, {
      onChange: (bounds) => this.handleBoundsChange(bounds),
      onInvalid: (message) => this.handleBoundsInvalid(message),
    });
    options.elements.fitButton.addEventListener("click", () => this.fitCurrentSdf());
  }

  get bounds(): Bounds3 {
    return this.currentBounds;
  }

  get valid(): boolean {
    return this.boundsAreValid;
  }

  applyExampleBounds(id: string): void {
    this.applyBounds(boundsForExample(id));
  }

  applyProfileBounds(bounds: Bounds3): void {
    this.applyBounds(bounds);
  }

  fitCurrentSdf(): void {
    const sdf = this.options.readActiveSdf();
    if (!sdf) {
      this.options.setEditorStatus("Fix code before fitting bounds", "error");
      return;
    }

    const { elements } = this.options;
    elements.fitButton.disabled = true;
    this.editor.setDisabled(true);
    elements.overlay.textContent = "Fitting bounds...";
    try {
      this.applyBounds(paddedBounds(estimateBounds(sdf)));
      this.options.updateSaveState();
      this.options.setEditorStatus("Fit bounds", "ok");
      this.options.invalidatePreview();
    } catch (error) {
      this.options.setEditorStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      elements.fitButton.disabled = false;
      this.editor.setDisabled(false);
    }
  }

  private applyBounds(bounds: Bounds3): void {
    this.currentBounds = cloneBounds(bounds);
    this.boundsAreValid = true;
    this.editor.setBounds(this.currentBounds);
  }

  private handleBoundsChange(bounds: Bounds3): void {
    this.currentBounds = cloneBounds(bounds);
    this.boundsAreValid = true;
    this.options.updateSaveState();
    this.options.setEditorStatus("Bounds updated", "ok");
    this.options.invalidatePreview();
  }

  private handleBoundsInvalid(message: string): void {
    this.boundsAreValid = false;
    this.options.updateSaveState();
    this.options.setEditorStatus(message, "error");
  }
}
