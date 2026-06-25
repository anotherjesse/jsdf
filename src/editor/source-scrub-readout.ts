import type { GraphSourceLink } from "./clean-source-patch";
import { formatScrubReadoutValue } from "./source-link-status-bar";

export class SourceScrubReadout {
  readonly element: HTMLDivElement;

  private clearTimer = 0;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "source-scrub-readout";
    this.element.setAttribute("aria-hidden", "true");
  }

  hide(): void {
    this.clearClearTimer();
    this.element.removeAttribute("data-visible");
  }

  clearClearTimer(): void {
    if (!this.clearTimer) return;
    window.clearTimeout(this.clearTimer);
    this.clearTimer = 0;
  }

  scheduleClear(isActive: () => boolean): void {
    this.clearClearTimer();
    this.clearTimer = window.setTimeout(() => {
      this.clearTimer = 0;
      if (!isActive()) this.element.removeAttribute("data-visible");
    }, 850);
  }

  showPointer(link: GraphSourceLink, value: number, event: MouseEvent, editorElement: HTMLElement | null): void {
    const editorBounds = editorElement?.getBoundingClientRect();
    if (!editorBounds) return;
    this.clearClearTimer();
    this.showAt(link, value, event.clientX - editorBounds.left + 12, event.clientY - editorBounds.top - 28);
  }

  showKeyboard(
    link: GraphSourceLink,
    value: number,
    visiblePosition: { left: number; top: number },
    editorElement: HTMLElement,
    isActive: () => boolean,
  ): void {
    const maxLeft = Math.max(4, editorElement.clientWidth - 110);
    const maxTop = Math.max(4, editorElement.clientHeight - 30);
    this.showAt(
      link,
      value,
      clamp(visiblePosition.left + 12, 4, maxLeft),
      clamp(visiblePosition.top - 28, 4, maxTop),
    );
    this.scheduleClear(isActive);
  }

  private showAt(link: GraphSourceLink, value: number, left: number, top: number): void {
    this.element.textContent = `${link.label} ${formatScrubReadoutValue(value)}`;
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
    this.element.dataset.visible = "true";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
