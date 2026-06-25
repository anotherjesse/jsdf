import { renderEyeIcon } from "./graph-visibility";

export interface GraphInspectorToolbarOptions {
  onFilterChange(filter: string): void;
  onSelectMatch(direction: -1 | 1): void;
  onToggleMap(showMap: boolean): void;
  onShowAllNodes(): void;
}

export interface GraphInspectorToolbarStats {
  filter: string;
  total: number;
  edges: number;
  visible: number;
  matched: number;
  hidden: number;
}

export class GraphInspectorToolbar {
  readonly element = document.createElement("div");
  private readonly filterInput = document.createElement("input");
  private readonly previousMatchButton = document.createElement("button");
  private readonly nextMatchButton = document.createElement("button");
  private readonly mapButton = document.createElement("button");
  private readonly showAllButton = document.createElement("button");
  private readonly showAllCount = document.createElement("span");
  private readonly summary = document.createElement("span");
  private showMap = false;

  constructor(private readonly options: GraphInspectorToolbarOptions) {
    this.element.className = "graph-toolbar";
    this.filterInput.type = "search";
    this.filterInput.className = "graph-filter-input";
    this.filterInput.placeholder = "Filter";
    this.filterInput.setAttribute("aria-label", "Filter graph nodes");
    this.filterInput.setAttribute("aria-keyshortcuts", "Control+F Meta+F /");
    this.previousMatchButton.type = "button";
    this.previousMatchButton.className = "graph-match-nav";
    this.previousMatchButton.textContent = "Prev";
    this.previousMatchButton.title = "Previous matching node (Shift+Enter or ArrowUp)";
    this.previousMatchButton.setAttribute("aria-label", "Previous matching graph node");
    this.previousMatchButton.setAttribute("aria-keyshortcuts", "Shift+Enter ArrowUp");
    this.previousMatchButton.hidden = true;
    this.nextMatchButton.type = "button";
    this.nextMatchButton.className = "graph-match-nav";
    this.nextMatchButton.textContent = "Next";
    this.nextMatchButton.title = "Next matching node (Enter or ArrowDown)";
    this.nextMatchButton.setAttribute("aria-label", "Next matching graph node");
    this.nextMatchButton.setAttribute("aria-keyshortcuts", "Enter ArrowDown");
    this.nextMatchButton.hidden = true;
    this.mapButton.type = "button";
    this.mapButton.className = "graph-map-toggle";
    this.mapButton.textContent = "Map";
    this.mapButton.title = "Toggle graph map";
    this.mapButton.setAttribute("aria-label", "Toggle graph map");
    this.mapButton.setAttribute("aria-pressed", "false");
    this.showAllButton.type = "button";
    this.showAllButton.className = "graph-show-all";
    this.showAllButton.title = "Show all hidden nodes (Shift+V)";
    this.showAllButton.setAttribute("aria-label", "Show all hidden graph nodes");
    this.showAllButton.setAttribute("aria-keyshortcuts", "Shift+V");
    this.showAllButton.hidden = true;
    this.showAllCount.className = "visibility-count";
    this.showAllCount.setAttribute("aria-hidden", "true");
    this.showAllButton.append(renderEyeIcon("visible"), this.showAllCount);
    this.summary.className = "graph-summary";
    this.filterInput.addEventListener("input", () => {
      this.options.onFilterChange(this.filterInput.value);
    });
    this.filterInput.addEventListener("keydown", (event) => {
      const matchDirection = filterMatchDirectionForKey(event);
      if (matchDirection) {
        event.preventDefault();
        this.options.onSelectMatch(matchDirection);
        return;
      }
      if (event.key === "Escape" && this.filterInput.value) {
        event.preventDefault();
        this.filterInput.value = "";
        this.options.onFilterChange("");
      }
    });
    this.previousMatchButton.addEventListener("click", () => this.options.onSelectMatch(-1));
    this.nextMatchButton.addEventListener("click", () => this.options.onSelectMatch(1));
    this.mapButton.addEventListener("click", () => {
      this.showMap = !this.showMap;
      this.mapButton.setAttribute("aria-pressed", String(this.showMap));
      this.options.onToggleMap(this.showMap);
    });
    this.showAllButton.addEventListener("click", () => this.options.onShowAllNodes());
    this.element.append(
      this.filterInput,
      this.previousMatchButton,
      this.nextMatchButton,
      this.mapButton,
      this.showAllButton,
      this.summary,
    );
  }

  focusFilter(options: { select?: boolean } = {}): void {
    this.filterInput.focus({ preventScroll: true });
    if (options.select) this.filterInput.select();
  }

  updateStats(stats: GraphInspectorToolbarStats): void {
    this.renderSummary(stats);
    this.updateMatchNavigation(stats);
    this.renderShowAllControl(stats.hidden);
  }

  private renderSummary(stats: GraphInspectorToolbarStats): void {
    const suffix = stats.hidden > 0 ? `, ${stats.hidden} hidden` : "";
    this.summary.textContent = stats.filter
      ? `${stats.matched} ${stats.matched === 1 ? "match" : "matches"}, ${stats.visible}/${stats.total} shown${suffix}`
      : `${stats.total} nodes, ${stats.edges} edges${suffix}`;
  }

  private updateMatchNavigation(stats: GraphInspectorToolbarStats): void {
    const show = stats.filter.trim() !== "" && stats.matched > 0;
    const enabled = show && stats.matched > 1;
    this.previousMatchButton.hidden = !show;
    this.nextMatchButton.hidden = !show;
    this.previousMatchButton.disabled = !enabled;
    this.nextMatchButton.disabled = !enabled;
  }

  private renderShowAllControl(hidden: number): void {
    this.showAllButton.hidden = hidden === 0;
    this.showAllCount.textContent = hidden > 99 ? "99+" : String(hidden);
    const label = hidden === 1 ? "Show 1 hidden node" : `Show ${hidden} hidden nodes`;
    this.showAllButton.title = `${label} (Shift+V)`;
    this.showAllButton.setAttribute("aria-label", label);
  }
}

function filterMatchDirectionForKey(event: KeyboardEvent): -1 | 1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "Enter") return event.shiftKey ? -1 : 1;
  if (event.shiftKey) return null;
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return null;
}
