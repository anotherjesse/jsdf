export class OrbitCamera {
  private azimuth = 0.83;
  private elevation = 0.47;
  private distance = 3.65;
  private dragging = false;
  private lastPointer = [0, 0];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void,
  ) {
    this.attachControls();
  }

  eye(center: number[], radius: number): number[] {
    const orbit = [
      Math.cos(this.elevation) * Math.cos(this.azimuth),
      Math.cos(this.elevation) * Math.sin(this.azimuth),
      Math.sin(this.elevation),
    ];
    return [
      center[0] + orbit[0] * radius * this.distance,
      center[1] + orbit[1] * radius * this.distance,
      center[2] + orbit[2] * radius * this.distance,
    ];
  }

  private attachControls(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastPointer = [event.clientX, event.clientY];
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointer[0];
      const dy = event.clientY - this.lastPointer[1];
      this.lastPointer = [event.clientX, event.clientY];
      this.azimuth -= dx * 0.007;
      this.elevation = clamp(this.elevation + dy * 0.007, -1.35, 1.35);
      this.onChange();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.001), 1.45, 9);
      this.onChange();
    }, { passive: false });
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}
