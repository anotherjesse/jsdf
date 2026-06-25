import type { Node, SDF3 } from "../core/nodes";
import { binarySTL, downloadBlob, generateMesh, type MeshAlgorithm, type MeshResult } from "../mesh/generate";
import type { Bounds3 } from "../mesh/bounds";
import { write_3mf, type ThreeMfExportReport } from "../mesh/three-mf";
import { OrbitCamera } from "./orbit-camera";
import { viewPanels, type PreviewLayout } from "./view-layout";
import { WebGLMeshRenderer } from "./webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "./webgl-raymarch-renderer";

export type RenderView = "shader" | "mesh";

export interface RenderHighlight {
  node: Node | null;
  mode: "mark" | "focus";
}

export interface PreviewViewportElements {
  canvas: HTMLCanvasElement;
  viewLabels: HTMLElement;
  shaderViewButton: HTMLButtonElement;
  meshViewButton: HTMLButtonElement;
  layoutViewButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  download3mfButton: HTMLButtonElement;
  surfaceNetButton: HTMLButtonElement;
  tetraMeshButton: HTMLButtonElement;
  stepsInput: HTMLInputElement;
  stepsOutput: HTMLOutputElement;
  gridInput: HTMLInputElement;
  gridOutput: HTMLOutputElement;
  previewStat: HTMLElement;
  meshStat: HTMLElement;
  triangleStat: HTMLElement;
  overlay: HTMLElement;
}

export interface PreviewViewportState {
  activeSdf: SDF3 | null;
  visibleSdf: SDF3 | null;
  renderSdf: SDF3 | null;
  bounds: Bounds3;
  documentName: string;
  shaderHighlight: RenderHighlight;
  meshHighlight: RenderHighlight;
  soloOverlayText: string;
  focusOverlayText: string;
  hasSoloPreview: boolean;
}

export interface PreviewViewportOptions {
  elements: PreviewViewportElements;
  readState(): PreviewViewportState;
  onPreviewSettingsChange(): void;
}

export interface PreviewViewportController {
  readonly ready: boolean;
  readonly viewMode: RenderView;
  readonly previewLayout: PreviewLayout;
  readonly meshAlgorithm: MeshAlgorithm;
  readonly meshTriangles: number | null;
  readonly meshBuildPending: boolean;
  readonly meshGrid: number;
  readonly raySteps: number;
  initialize(): void;
  activeRenderer(): { redraw(): void } | null;
  handleResize(): void;
  setShaderMode(): void;
  showMesh(): Promise<void>;
  showSoloPreview(): void;
  clearSoloPreview(): void;
  schedulePreview(delay?: number): void;
  scheduleActivePreview(delay?: number): void;
  renderCurrent(): Promise<void>;
  renderShaderPreviewForSession(sourceValid: boolean, waitForFrame: () => Promise<void>): Promise<void>;
  invalidateMeshForActiveSdf(): void;
  updateMeshHighlight(): void;
  setMeshAlgorithm(algorithm: MeshAlgorithm): void;
  setMeshAlgorithmMode(algorithm: MeshAlgorithm, options: { rebuild: boolean }): void;
  setPreviewLayout(layout: PreviewLayout, options?: { recordChange?: boolean }): void;
  applyRange(input: HTMLInputElement, output: HTMLOutputElement, value: number): void;
}

export function createPreviewViewportController(options: PreviewViewportOptions): PreviewViewportController {
  return new PreviewViewportControllerImpl(options);
}

class PreviewViewportControllerImpl implements PreviewViewportController {
  private rayRenderer: WebGLRaymarchRenderer | null = null;
  private meshRenderer: WebGLMeshRenderer | null = null;
  private mesh: MeshResult | null = null;
  private meshBuildPromise: Promise<void> | null = null;
  private lastBlob: Blob | null = null;
  private last3mfReport: ThreeMfExportReport | null = null;
  private renderJob = 0;
  private meshJob = 0;
  private previewTimer = 0;
  private meshTimer = 0;
  private viewModeValue: RenderView = "shader";
  private desiredViewMode: RenderView = "shader";
  private previewLayoutValue: PreviewLayout = "single";
  private meshAlgorithmValue: MeshAlgorithm = "surface-net";

  constructor(private readonly options: PreviewViewportOptions) {
    const { elements } = options;
    elements.stepsOutput.value = elements.stepsInput.value;
    elements.gridOutput.value = elements.gridInput.value;
    elements.stepsInput.addEventListener("input", () => {
      elements.stepsOutput.value = elements.stepsInput.value;
      options.onPreviewSettingsChange();
      this.schedulePreview();
    });
    elements.gridInput.addEventListener("input", () => {
      elements.gridOutput.value = elements.gridInput.value;
      options.onPreviewSettingsChange();
      if (this.viewModeValue === "mesh") {
        this.clearMesh({ keepView: true, meshStatText: "queued" });
        this.scheduleMeshBuild();
      } else {
        this.clearMesh();
      }
    });
    elements.shaderViewButton.addEventListener("click", () => this.setShaderMode());
    elements.meshViewButton.addEventListener("click", () => {
      this.desiredViewMode = "mesh";
      void this.showMesh();
    });
    elements.layoutViewButton.addEventListener("click", () => {
      this.setPreviewLayout(this.previewLayoutValue === "single" ? "quad" : "single");
    });
    elements.surfaceNetButton.addEventListener("click", () => this.setMeshAlgorithm("surface-net"));
    elements.tetraMeshButton.addEventListener("click", () => this.setMeshAlgorithm("tetra"));
    elements.downloadButton.addEventListener("click", () => {
      if (this.lastBlob) downloadBlob(this.lastBlob, `${slugify(options.readState().documentName)}.stl`);
    });
    elements.download3mfButton.addEventListener("click", () => {
      if (!this.mesh) return;
      const state = options.readState();
      if (!state.visibleSdf) return;
      const export3mf = write_3mf(`${slugify(state.documentName)}.3mf`, this.mesh, state.visibleSdf, {
        download: false,
        name: state.documentName,
      });
      downloadBlob(export3mf.blob, `${slugify(state.documentName)}.3mf`);
      if (export3mf.report.warnings.length > 0) {
        console.warn("3MF export warnings", export3mf.report);
      }
    });
  }

  get ready(): boolean {
    return Boolean(this.rayRenderer && this.meshRenderer);
  }

  get viewMode(): RenderView {
    return this.viewModeValue;
  }

  get previewLayout(): PreviewLayout {
    return this.previewLayoutValue;
  }

  get meshAlgorithm(): MeshAlgorithm {
    return this.meshAlgorithmValue;
  }

  get meshTriangles(): number | null {
    return this.mesh ? this.mesh.triangles.length : null;
  }

  get meshBuildPending(): boolean {
    return Boolean(this.meshBuildPromise);
  }

  get meshGrid(): number {
    return Number(this.options.elements.gridInput.value);
  }

  get raySteps(): number {
    return Number(this.options.elements.stepsInput.value);
  }

  initialize(): void {
    const camera = new OrbitCamera(this.options.elements.canvas, () => this.activeRenderer()?.redraw());
    this.rayRenderer = new WebGLRaymarchRenderer(this.options.elements.canvas, camera);
    this.meshRenderer = new WebGLMeshRenderer(this.options.elements.canvas, camera);
    this.setPreviewLayout(this.previewLayoutValue, { recordChange: false });
    this.setViewMode("shader");
  }

  activeRenderer(): { redraw(): void } | null {
    return this.viewModeValue === "shader" ? this.rayRenderer : this.meshRenderer;
  }

  handleResize(): void {
    this.activeRenderer()?.redraw();
    this.renderViewLabels();
  }

  setShaderMode(): void {
    this.desiredViewMode = "shader";
    window.clearTimeout(this.meshTimer);
    this.setViewMode("shader");
  }

  async showMesh(): Promise<void> {
    if (!this.mesh || this.mesh.triangles.length === 0) this.setViewMode("mesh");
    await this.buildMesh();
    if (this.desiredViewMode === "mesh" && this.mesh && this.mesh.triangles.length > 0) this.setViewMode("mesh");
  }

  showSoloPreview(): void {
    this.meshRenderer?.setActive(false);
    this.rayRenderer?.setActive(true);
    this.schedulePreview(0);
  }

  clearSoloPreview(): void {
    if (this.viewModeValue === "mesh") {
      this.rayRenderer?.setActive(false);
      this.meshRenderer?.setActive(true);
      this.meshRenderer?.redraw();
      this.setViewMode("mesh");
      return;
    }
    this.schedulePreview(0);
  }

  schedulePreview(delay = 300): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => void this.renderCurrent(), delay);
  }

  scheduleActivePreview(delay = 0): void {
    if (this.viewModeValue === "mesh" && !this.options.readState().hasSoloPreview) {
      this.updateMeshHighlight();
      return;
    }
    this.schedulePreview(delay);
  }

  async renderCurrent(): Promise<void> {
    if (!this.rayRenderer) return;
    const state = this.options.readState();
    if (!state.renderSdf) {
      this.options.elements.previewStat.textContent = "-";
      this.options.elements.overlay.textContent = state.activeSdf
        ? "No visible graph nodes."
        : "Write editor code that returns an SDF3.";
      return;
    }

    const job = this.renderJob + 1;
    this.renderJob = job;
    this.options.elements.overlay.textContent = "Compiling shader preview...";
    this.options.elements.stepsInput.disabled = true;
    const start = performance.now();
    try {
      if (job !== this.renderJob) return;
      this.rayRenderer.render(state.renderSdf, state.bounds, this.raySteps, state.shaderHighlight.node, state.shaderHighlight.mode);
      this.options.elements.previewStat.textContent = `${(performance.now() - start).toFixed(1)} ms`;
      if (state.soloOverlayText) {
        this.options.elements.overlay.textContent = state.soloOverlayText;
      } else if (state.focusOverlayText) {
        this.options.elements.overlay.textContent = state.focusOverlayText;
      } else if (this.viewModeValue === "shader") {
        this.options.elements.overlay.textContent = "";
      }
    } catch (error) {
      this.options.elements.overlay.textContent = error instanceof Error ? error.message : String(error);
      this.options.elements.previewStat.textContent = "failed";
    } finally {
      if (job === this.renderJob) this.options.elements.stepsInput.disabled = false;
    }
  }

  async renderShaderPreviewForSession(sourceValid: boolean, waitForFrame: () => Promise<void>): Promise<void> {
    this.desiredViewMode = "shader";
    window.clearTimeout(this.meshTimer);
    this.setViewMode("shader");
    window.clearTimeout(this.previewTimer);
    this.previewTimer = 0;
    if (sourceValid) await this.renderCurrent();
    else this.activeRenderer()?.redraw();
    await waitForFrame();
  }

  invalidateMeshForActiveSdf(): void {
    if (this.desiredViewMode === "mesh" || this.viewModeValue === "mesh") {
      this.clearMesh({ keepView: this.viewModeValue === "mesh", meshStatText: "queued" });
      this.scheduleMeshBuild();
      return;
    }
    this.clearMesh();
  }

  updateMeshHighlight(): void {
    if (!this.mesh || this.mesh.triangles.length === 0) return;
    const state = this.options.readState();
    if (!state.visibleSdf) return;
    this.meshRenderer?.setHighlight(state.visibleSdf, state.meshHighlight.node, state.meshHighlight.mode);
    if (this.viewModeValue === "mesh") this.options.elements.overlay.textContent = state.focusOverlayText;
  }

  setMeshAlgorithm(algorithm: MeshAlgorithm): void {
    this.setMeshAlgorithmMode(algorithm, { rebuild: true });
  }

  setMeshAlgorithmMode(algorithm: MeshAlgorithm, options: { rebuild: boolean }): void {
    if (this.meshAlgorithmValue === algorithm) return;
    this.meshAlgorithmValue = algorithm;
    this.options.elements.surfaceNetButton.setAttribute("aria-pressed", String(algorithm === "surface-net"));
    this.options.elements.tetraMeshButton.setAttribute("aria-pressed", String(algorithm === "tetra"));
    this.options.onPreviewSettingsChange();
    if (!options.rebuild) return;
    if (this.viewModeValue === "mesh") {
      this.clearMesh({ keepView: true, meshStatText: "queued" });
      this.scheduleMeshBuild();
    } else {
      this.clearMesh();
    }
  }

  setPreviewLayout(layout: PreviewLayout, options: { recordChange?: boolean } = {}): void {
    this.previewLayoutValue = layout;
    this.options.elements.layoutViewButton.setAttribute("aria-pressed", String(layout === "quad"));
    this.options.elements.layoutViewButton.title = layout === "quad" ? "Use single view" : "Use 2x2 view";
    this.options.elements.layoutViewButton.setAttribute("aria-label", this.options.elements.layoutViewButton.title);
    this.rayRenderer?.setLayout(layout);
    this.meshRenderer?.setLayout(layout);
    this.renderViewLabels();
    if (options.recordChange !== false) this.options.onPreviewSettingsChange();
    this.activeRenderer()?.redraw();
  }

  applyRange(input: HTMLInputElement, output: HTMLOutputElement, value: number): void {
    const min = Number(input.min);
    const max = Number(input.max);
    const clamped = Math.min(max, Math.max(min, value));
    input.value = String(clamped);
    output.value = input.value;
  }

  private setViewMode(mode: RenderView): void {
    this.desiredViewMode = mode;
    if (mode === "mesh" && (!this.mesh || this.mesh.triangles.length === 0)) {
      this.options.elements.shaderViewButton.setAttribute("aria-pressed", "false");
      this.options.elements.meshViewButton.setAttribute("aria-pressed", "true");
      this.options.elements.overlay.textContent = this.meshBuildPromise ? "Building mesh..." : "";
      return;
    }
    this.viewModeValue = mode;
    this.options.elements.shaderViewButton.setAttribute("aria-pressed", String(mode === "shader"));
    this.options.elements.meshViewButton.setAttribute("aria-pressed", String(mode === "mesh"));
    this.rayRenderer?.setActive(mode === "shader");
    this.meshRenderer?.setActive(mode === "mesh");
    if (mode === "mesh") this.updateMeshHighlight();
    this.options.elements.overlay.textContent = "";
  }

  private clearMesh(options: { keepView?: boolean; meshStatText?: string } = {}): void {
    window.clearTimeout(this.meshTimer);
    this.meshJob += 1;
    this.meshBuildPromise = null;
    this.mesh = null;
    this.lastBlob = null;
    this.last3mfReport = null;
    this.options.elements.downloadButton.disabled = true;
    this.options.elements.download3mfButton.disabled = true;
    this.options.elements.meshViewButton.disabled = false;
    this.options.elements.meshViewButton.removeAttribute("aria-busy");
    this.options.elements.triangleStat.textContent = "-";
    this.options.elements.meshStat.textContent = options.meshStatText ?? "-";
    if (this.viewModeValue === "mesh") {
      if (options.keepView) {
        this.options.elements.overlay.textContent = `Regenerating mesh at ${this.gridLabel()}...`;
        this.options.elements.shaderViewButton.setAttribute("aria-pressed", "false");
        this.options.elements.meshViewButton.setAttribute("aria-pressed", "true");
        return;
      }
      this.setViewMode("shader");
    }
  }

  private renderViewLabels(): void {
    const { canvas, viewLabels } = this.options.elements;
    viewLabels.replaceChildren();
    viewLabels.hidden = this.previewLayoutValue !== "quad";
    if (this.previewLayoutValue !== "quad") return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    for (const panel of viewPanels(this.previewLayoutValue, width, height)) {
      const label = document.createElement("span");
      label.className = "view-label";
      label.textContent = panel.label;
      label.style.left = `${panel.x + 10}px`;
      label.style.top = `${height - panel.y - panel.height + 10}px`;
      viewLabels.append(label);
    }
  }

  private scheduleMeshBuild(delay = 300): void {
    window.clearTimeout(this.meshTimer);
    this.meshTimer = window.setTimeout(() => void this.rebuildMeshView(), delay);
  }

  private async rebuildMeshView(): Promise<void> {
    if (this.desiredViewMode !== "mesh") return;
    await this.buildMesh();
    if (this.desiredViewMode === "mesh" && this.viewModeValue === "mesh" && this.mesh && this.mesh.triangles.length > 0) {
      this.setViewMode("mesh");
    }
  }

  private async buildMesh(): Promise<void> {
    if (this.mesh && this.mesh.triangles.length > 0) return;
    if (this.meshBuildPromise) return this.meshBuildPromise;
    const state = this.options.readState();
    if (!state.visibleSdf) {
      this.options.elements.overlay.textContent = state.activeSdf
        ? "No visible graph nodes to mesh."
        : "Fix the editor code before building mesh view.";
      return;
    }

    const job = this.meshJob + 1;
    this.meshJob = job;
    this.options.elements.meshViewButton.disabled = true;
    this.options.elements.meshViewButton.setAttribute("aria-busy", "true");
    this.options.elements.downloadButton.disabled = true;
    this.options.elements.download3mfButton.disabled = true;
    this.options.elements.meshStat.textContent = "building";
    this.options.elements.overlay.textContent = `Sampling and polygonizing ${this.gridLabel()}...`;

    const buildPromise = (async () => {
      try {
        const result = await generateMesh(state.visibleSdf!, {
          grid: this.meshGrid,
          bounds: state.bounds,
          preferGPU: true,
          algorithm: this.meshAlgorithmValue,
        });
        if (job !== this.meshJob) return;
        this.mesh = result;
        const nextState = this.options.readState();
        const visibleSdf = nextState.visibleSdf ?? state.visibleSdf!;
        this.meshRenderer?.render(this.mesh.triangles, this.mesh.bounds, visibleSdf, nextState.meshHighlight.node, nextState.meshHighlight.mode);
        this.lastBlob = binarySTL(this.mesh.triangles, `sdf-browser ${nextState.documentName}`);
        this.last3mfReport = write_3mf(`${slugify(nextState.documentName)}.3mf`, this.mesh, visibleSdf, {
          download: false,
          name: nextState.documentName,
        }).report;
        const total = this.mesh.sampleTimeMs + this.mesh.polygonizeTimeMs;
        this.options.elements.meshStat.textContent = `${total.toFixed(0)} ms ${this.mesh.usedGPU ? "GPU" : "CPU"}${this.mesh.usedWorker ? " worker" : ""} ${algorithmLabel(this.mesh.algorithm)}`;
        this.options.elements.triangleStat.textContent = this.mesh.triangles.length.toLocaleString();
        this.options.elements.downloadButton.disabled = this.mesh.triangles.length === 0;
        this.options.elements.download3mfButton.disabled = this.mesh.triangles.length === 0;
        if (this.mesh.triangles.length === 0) {
          this.mesh = null;
          this.lastBlob = null;
          this.last3mfReport = null;
          this.options.elements.overlay.textContent = "Generated no triangles. Try wider bounds or a lower-level example.";
          return;
        }
        this.options.elements.overlay.textContent = this.last3mfReport.warnings.length > 0
          ? `3MF warning: ${this.last3mfReport.warnings[0]}`
          : "";
      } catch (error) {
        if (job !== this.meshJob) return;
        this.options.elements.overlay.textContent = error instanceof Error ? error.message : String(error);
        this.options.elements.meshStat.textContent = "failed";
      } finally {
        if (job === this.meshJob) {
          this.options.elements.meshViewButton.disabled = false;
          this.options.elements.meshViewButton.removeAttribute("aria-busy");
        }
      }
    })();

    this.meshBuildPromise = buildPromise;
    try {
      await buildPromise;
    } finally {
      if (this.meshBuildPromise === buildPromise) this.meshBuildPromise = null;
    }
  }

  private gridLabel(): string {
    const grid = this.meshGrid;
    return `${grid}^3 (${(grid ** 3).toLocaleString()} samples)`;
  }
}

function algorithmLabel(algorithm: MeshAlgorithm): string {
  return algorithm === "surface-net" ? "surface-net" : "tetra";
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "sdf";
}
