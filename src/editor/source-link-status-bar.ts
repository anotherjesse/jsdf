import type { GraphSourceLink } from "./clean-source-patch";
import type { ScrubModifiers } from "./scrub-values";

export interface SourceLinkStatusNavigationState {
  index: number;
  total: number;
}

export interface SourceLinkStatusBarCallbacks {
  onNavigate(direction: -1 | 1): void;
  onNudge(direction: -1 | 1, modifiers: ScrubModifiers): void;
  onReveal(): void;
}

export class SourceLinkStatusBar {
  readonly element: HTMLDivElement;

  private readonly target: HTMLButtonElement;
  private readonly text: HTMLSpanElement;
  private readonly navigationIndex: HTMLSpanElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly controls: HTMLSpanElement;
  private readonly decreaseButton: HTMLButtonElement;
  private readonly increaseButton: HTMLButtonElement;

  constructor(callbacks: SourceLinkStatusBarCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "source-link-status";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Selected graph source link");
    this.element.setAttribute("aria-live", "polite");

    this.target = document.createElement("button");
    this.target.type = "button";
    this.target.className = "source-link-status-target";
    this.target.disabled = true;

    this.text = document.createElement("span");
    this.text.className = "source-link-status-text";
    this.target.append(this.text);

    const navigation = document.createElement("span");
    navigation.className = "source-link-status-navigation";
    this.previousButton = renderSourceLinkNavigationButton("previous", "<");
    this.nextButton = renderSourceLinkNavigationButton("next", ">");
    this.navigationIndex = document.createElement("span");
    this.navigationIndex.className = "source-link-status-index";
    navigation.append(this.previousButton, this.navigationIndex, this.nextButton);

    this.controls = document.createElement("span");
    this.controls.className = "source-link-status-controls";
    this.controls.hidden = true;
    this.decreaseButton = renderSourceLinkStepButton("decrease", "-");
    this.increaseButton = renderSourceLinkStepButton("increase", "+");
    this.controls.append(this.decreaseButton, this.increaseButton);

    this.element.append(this.target, navigation, this.controls);

    this.decreaseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onNudge(-1, modifiersForMouseEvent(event));
    });
    this.increaseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onNudge(1, modifiersForMouseEvent(event));
    });
    this.previousButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onNavigate(-1);
    });
    this.nextButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onNavigate(1);
    });
    this.target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onReveal();
    });
  }

  update(
    link: GraphSourceLink | null,
    options: { value?: number | null; navigation?: SourceLinkStatusNavigationState } = {},
  ): void {
    if (!link) {
      this.hide();
      return;
    }

    const value = options.value ?? null;
    const isNumber = value != null;
    const sourceLabel = sourceLinkStatusTextForLink(link);
    const navigationState = options.navigation ?? { index: -1, total: 0 };
    const hasNavigation = navigationState.total > 1;
    const navigationText = navigationState.total > 0
      ? `${Math.max(0, navigationState.index) + 1}/${navigationState.total}`
      : "";

    this.element.hidden = false;
    this.element.dataset.numeric = String(isNumber);
    this.element.title = sourceLinkHoverMessage(link, isNumber);
    this.text.textContent = sourceLinkStatusTextForLink(link, value);

    this.target.disabled = false;
    this.target.setAttribute("aria-label", `Reveal ${sourceLabel} in Graph`);

    this.previousButton.disabled = !hasNavigation;
    this.nextButton.disabled = !hasNavigation;
    this.previousButton.setAttribute("aria-label", `Previous graph-linked code range from ${sourceLabel}`);
    this.nextButton.setAttribute("aria-label", `Next graph-linked code range from ${sourceLabel}`);
    this.previousButton.title = "Previous linked range (Cmd/Ctrl+Alt+Up)";
    this.nextButton.title = "Next linked range (Cmd/Ctrl+Alt+Down)";

    this.navigationIndex.textContent = navigationText;
    this.navigationIndex.setAttribute("aria-label", navigationText ? `Linked range ${navigationText}` : "No linked range");
    this.navigationIndex.title = navigationText ? `Linked range ${navigationText}` : "";

    this.controls.hidden = !isNumber;
    this.decreaseButton.disabled = !isNumber;
    this.increaseButton.disabled = !isNumber;
    this.decreaseButton.setAttribute("aria-label", `Decrease ${sourceLabel}`);
    this.increaseButton.setAttribute("aria-label", `Increase ${sourceLabel}`);
    this.decreaseButton.title = "Decrease value; Shift/Alt-click for finer steps";
    this.increaseButton.title = "Increase value; Shift/Alt-click for finer steps";
  }

  private hide(): void {
    this.element.hidden = true;
    this.element.removeAttribute("title");
    delete this.element.dataset.numeric;
    this.text.textContent = "";
    this.target.disabled = true;
    this.target.removeAttribute("aria-label");
    this.previousButton.disabled = true;
    this.nextButton.disabled = true;
    this.navigationIndex.textContent = "";
    this.navigationIndex.removeAttribute("aria-label");
    this.navigationIndex.removeAttribute("title");
    this.controls.hidden = true;
    this.decreaseButton.disabled = true;
    this.increaseButton.disabled = true;
  }
}

export function sourceLinkHoverMessage(link: GraphSourceLink, isNumber: boolean): string {
  const target = `${link.nodeKind} #${link.nodeId} ${link.label}`;
  return isNumber
    ? `Graph: ${target}. Drag sideways or press Alt+Up/Down to tweak. Use chip arrows or Cmd/Ctrl+Alt+Up/Down to inspect linked ranges; Cmd/Ctrl-click opens this node in Graph.`
    : `Graph: ${target}. Use chip arrows or Cmd/Ctrl+Alt+Up/Down to inspect linked ranges; Cmd/Ctrl-click opens this node in Graph.`;
}

export function sourceLinkStatusText(link: GraphSourceLink, value: number | null = null): string {
  return sourceLinkStatusTextForLink(link, value);
}

export function formatScrubReadoutValue(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

function sourceLinkStatusTextForLink(link: GraphSourceLink, value: number | null = null): string {
  const label = `${link.nodeKind} #${link.nodeId} · ${link.label}`;
  return value == null ? label : `${label} = ${formatScrubReadoutValue(value)}`;
}

function renderSourceLinkStepButton(direction: "decrease" | "increase", label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-link-status-step";
  button.dataset.direction = direction;
  button.textContent = label;
  button.disabled = true;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}

function renderSourceLinkNavigationButton(direction: "previous" | "next", label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-link-status-nav";
  button.dataset.direction = direction;
  button.textContent = label;
  button.disabled = true;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}

function modifiersForMouseEvent(event: MouseEvent): ScrubModifiers {
  return {
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}
