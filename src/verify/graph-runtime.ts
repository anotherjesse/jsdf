import type { Node } from "../core/nodes";
import { findGraphSourceLinks, type GraphSourceLink } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import type { GraphParamEdit } from "../editor/graph-edit-model";
import { GraphInspector } from "../editor/graph-inspector";
import {
  verifySourceDialog,
  verifyWorkspaceStorage,
  type SourceDialogRuntimeVerification,
  type WorkspaceStorageRuntimeVerification,
} from "./source-workspace-runtime";
import { verifySourcePatch, verifyVectorSourcePatches } from "./source-patch-runtime";
import {
  verifyChangeJournal,
  verifyHistoryCoalescing,
  verifyScrubValues,
  type GraphChangeJournalVerification,
  type GraphHistoryRuntimeVerification,
  type GraphScrubValuesVerification,
} from "./graph-history-runtime";
import { findNodeByKind } from "./graph-node-runtime";
import { verifyOrientationControl } from "./graph-orientation-runtime";

export interface GraphRuntimeVerification {
  ok: boolean;
  nodes: number;
  treeHeaders: number;
  eyeButtons: number;
  isolateButtons: number;
  mapEyes: number;
  links: number;
  selectedNode: string;
  editedRows: number;
  hiddenEvents: number[][];
  hoverEvents: Array<{ label: string; shiftKey: boolean }>;
  hoverLabels: string[];
  sourceHoverLabels: string[];
  revealedSource: string;
  soloLabels: string[];
  sourcePatch: string;
  vectorSourcePatches: string[];
  scrubValues: GraphScrubValuesVerification;
  history: GraphHistoryRuntimeVerification;
  changeJournal: GraphChangeJournalVerification;
  sourceDialog: SourceDialogRuntimeVerification;
  workspaceStorage: WorkspaceStorageRuntimeVerification;
  errors: string[];
}

const fixtureSource = `
const left = sphere(1).translate([-0.45, 0, 0])
const right = box(0.8).translate([0.45, 0, 0])
return left.union(right, { k: 0.12 })
`;

export async function runGraphRuntimeVerification(root: HTMLElement): Promise<GraphRuntimeVerification> {
  const errors: string[] = [];
  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const hiddenEvents: number[][] = [];
  const hoverEvents: Array<{ label: string; shiftKey: boolean }> = [];
  const hoverLabels: string[] = [];
  const sourceHoverLabels: string[] = [];
  const soloLabels: string[] = [];
  let selectedNode = "";
  let revealedSource = "";
  let lastEdit: GraphParamEdit | null = null;

  const inspector = new GraphInspector(root, {
    onSelect(node) {
      selectedNode = node ? `${node.kind} #${node.id}` : "";
    },
    onHover(node, options) {
      const label = node ? `${node.kind} #${node.id}` : "";
      hoverEvents.push({ label, shiftKey: options.shiftKey });
      hoverLabels.push(label);
    },
    onEdit(edit) {
      lastEdit = edit;
    },
    onSolo(preview) {
      soloLabels.push(preview?.label ?? "");
    },
    onRevealSource(link) {
      revealedSource = `${link.nodeKind}:${link.label}`;
    },
    onSourceHover(link) {
      sourceHoverLabels.push(link ? `${link.nodeKind}:${link.label}` : "");
    },
    onVisibilityChange(ids) {
      hiddenEvents.push([...ids]);
    },
  });

  inspector.setSdf(sdf);
  inspector.setSourceLinks(links);

  const sphereNode = findNodeByKind(sdf.node, "sphere");
  if (!sphereNode) {
    errors.push("fixture has no sphere node");
  } else {
    verifyInspector(root, inspector, sphereNode, links, hoverLabels, errors);
  }
  verifyOrientationControl(errors);

  const history = verifyHistoryCoalescing(errors);
  const changeJournal = verifyChangeJournal(errors);
  const scrubValues = verifyScrubValues(errors);
  const sourceDialog = verifySourceDialog(errors);
  const workspaceStorage = verifyWorkspaceStorage(errors);
  verifySharedGraphNodeElementIds(errors);

  return {
    ok: errors.length === 0,
    nodes: root.querySelectorAll(".graph-node").length,
    treeHeaders: root.querySelectorAll(".graph-tree-header").length,
    eyeButtons: root.querySelectorAll(".graph-visibility").length,
    isolateButtons: root.querySelectorAll(".graph-isolate").length,
    mapEyes: root.querySelectorAll(".graph-map-eye").length,
    links: links.length,
    selectedNode,
    editedRows: root.querySelectorAll(".param-row.edited, .axis-control.edited").length,
    hiddenEvents,
    hoverEvents,
    hoverLabels,
    sourceHoverLabels,
    revealedSource,
    soloLabels,
    sourcePatch: verifySourcePatch(fixtureSource, lastEdit, sdf, errors),
    vectorSourcePatches: verifyVectorSourcePatches(errors),
    scrubValues,
    history,
    changeJournal,
    sourceDialog,
    workspaceStorage,
    errors,
  };

  function verifyInspector(
    graphRoot: HTMLElement,
    graphInspector: GraphInspector,
    sphere: Node,
    sourceLinks: GraphSourceLink[],
    graphHoverLabels: string[],
    verifyErrors: string[],
  ): void {
    if (graphRoot.querySelectorAll(".graph-node").length < 4) {
      verifyErrors.push("graph tree rendered too few nodes");
    }
    if (graphRoot.querySelectorAll(".graph-tree-header").length !== 1) {
      verifyErrors.push("graph tree visibility header did not render");
    }
    const initialHeaderEye = graphRoot.querySelector<HTMLButtonElement>(".graph-tree-header-eye");
    if (!initialHeaderEye) {
      verifyErrors.push("graph tree visibility header eye did not render");
    } else {
      if (!initialHeaderEye.disabled) verifyErrors.push("graph tree visibility header eye should be disabled with no hidden nodes");
      if (initialHeaderEye.getAttribute("aria-label") !== "Visibility column") {
        verifyErrors.push("graph tree visibility header eye had unclear empty label");
      }
    }
    if (sourceLinks.length < 4) {
      verifyErrors.push("source links found too few graph ranges");
    }
    if (!graphInspector.selectNodeById(sphere.id)) {
      verifyErrors.push("could not select sphere node");
      return;
    }
    const linkedChip = graphRoot.querySelector<HTMLElement>(".param-source-chip");
    if (!linkedChip || linkedChip.dataset.state !== "linked" || linkedChip.textContent !== "Code") {
      verifyErrors.push(`selected sphere source chip rendered ${linkedChip?.dataset.state || "nothing"} ${linkedChip?.textContent || ""}`);
    }
    if (linkedChip?.getAttribute("aria-label") !== "Reveal this node in editable code") {
      verifyErrors.push("linked source chip had unclear label");
    }
    if (linkedChip?.getAttribute("aria-keyshortcuts") !== "C") {
      verifyErrors.push("linked source chip did not advertise code reveal shortcut");
    }
    linkedChip?.click();
    if (revealedSource !== "sphere:call") {
      verifyErrors.push(`linked source chip emitted ${revealedSource || "nothing"}`);
    }
    graphInspector.setSourceLinks([]);
    const derivedChip = graphRoot.querySelector<HTMLElement>(".param-source-chip");
    if (!derivedChip || derivedChip.dataset.state !== "derived" || derivedChip.textContent !== "Derived") {
      verifyErrors.push(`unlinked source chip rendered ${derivedChip?.dataset.state || "nothing"} ${derivedChip?.textContent || ""}`);
    }
    graphInspector.setSourceLinks(sourceLinks);
    graphInspector.selectNodeById(sphere.id);
    const sphereHoverLabel = `${sphere.kind} #${sphere.id}`;
    const selectedNodeShortcutText = graphRoot
      .querySelector<HTMLElement>(`.graph-node[data-node-id="${sphere.id}"]`)
      ?.getAttribute("aria-keyshortcuts") ?? "";
    for (const shortcut of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "V", "Shift+V", "I", "C"]) {
      if (!selectedNodeShortcutText.split(/\s+/).includes(shortcut)) {
        verifyErrors.push(`selected graph node shortcuts missed ${shortcut}: ${selectedNodeShortcutText || "nothing"}`);
      }
    }

    graphInspector.setFocusHoveredNodeById(sphere.id);
    if (!graphRoot.querySelector(`.graph-node[data-node-id="${sphere.id}"].focus-peek`)) {
      verifyErrors.push("external focus hover did not mark focused graph row");
    }
    graphInspector.setFocusHoveredNodeById(null);
    if (graphRoot.querySelector(".graph-node.focus-peek")) {
      verifyErrors.push("clearing external focus hover left graph row marked");
    }

    const filterInput = graphRoot.querySelector<HTMLInputElement>(".graph-toolbar input[type='search']");
    if (!filterInput) {
      verifyErrors.push("graph filter input did not render");
    } else {
      if (filterInput.getAttribute("aria-keyshortcuts") !== "Control+F Meta+F /") {
        verifyErrors.push(`graph filter shortcut rendered ${filterInput.getAttribute("aria-keyshortcuts") || "nothing"}`);
      }
      filterInput.value = "radius";
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (!graphRoot.querySelector(".param-row.matched")) {
        verifyErrors.push("filter did not mark matching radius param row");
      }
      filterInput.value = "translate";
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      const previousMatch = graphRoot.querySelector<HTMLButtonElement>(".graph-match-nav[aria-label='Previous matching graph node']");
      const nextMatch = graphRoot.querySelector<HTMLButtonElement>(".graph-match-nav[aria-label='Next matching graph node']");
      if (previousMatch?.getAttribute("aria-keyshortcuts") !== "Shift+Enter ArrowUp") {
        verifyErrors.push(`previous match shortcut rendered ${previousMatch?.getAttribute("aria-keyshortcuts") || "nothing"}`);
      }
      if (nextMatch?.getAttribute("aria-keyshortcuts") !== "Enter ArrowDown") {
        verifyErrors.push(`next match shortcut rendered ${nextMatch?.getAttribute("aria-keyshortcuts") || "nothing"}`);
      }
      filterInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      const firstSearchSelection = selectedNode;
      if (!firstSearchSelection.includes("translate")) {
        verifyErrors.push(`filter ArrowDown selected ${firstSearchSelection || "nothing"}`);
      }
      filterInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      const secondSearchSelection = selectedNode;
      if (!secondSearchSelection.includes("translate") || secondSearchSelection === firstSearchSelection) {
        verifyErrors.push(`filter ArrowDown did not advance: ${firstSearchSelection || "nothing"} -> ${secondSearchSelection || "nothing"}`);
      }
      filterInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
      if (selectedNode !== firstSearchSelection) {
        verifyErrors.push(`filter ArrowUp returned to ${selectedNode || "nothing"} instead of ${firstSearchSelection || "nothing"}`);
      }
      filterInput.value = "";
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (graphRoot.querySelector(".param-row.matched")) {
        verifyErrors.push("clearing filter left matched param row marked");
      }
      graphInspector.selectNodeById(sphere.id);
    }

    const currentCrumb = graphRoot.querySelector<HTMLElement>(".param-breadcrumb button[aria-current='page']");
    if (!currentCrumb) {
      verifyErrors.push("selected sphere has no current breadcrumb crumb");
    } else {
      const relationLabels = [...graphRoot.querySelectorAll<HTMLElement>(".param-breadcrumb button small")]
        .map((label) => label.textContent ?? "");
      if (relationLabels.join(" > ") !== "root > part 1 > input") {
        verifyErrors.push(`breadcrumb relations rendered ${relationLabels.join(" > ") || "nothing"}`);
      }
      if (!currentCrumb.getAttribute("aria-label")?.startsWith("input: sphere")) {
        verifyErrors.push(`current breadcrumb label was ${currentCrumb.getAttribute("aria-label") || "missing"}`);
      }
      currentCrumb.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== sphereHoverLabel) {
        verifyErrors.push(`breadcrumb hover focused ${graphHoverLabels.at(-1) || "nothing"}`);
      }
      if (sourceHoverLabels.at(-1) !== "sphere:call") {
        verifyErrors.push(`breadcrumb hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
      }
      currentCrumb.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== "") verifyErrors.push("breadcrumb leave did not clear graph hover");
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("breadcrumb leave did not clear source hover");
      currentCrumb.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== sphereHoverLabel) verifyErrors.push("breadcrumb focus did not inspect node");
      if (sourceHoverLabels.at(-1) !== "sphere:call") verifyErrors.push("breadcrumb focus did not emit source hover");
      currentCrumb.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== "") verifyErrors.push("breadcrumb blur did not clear graph hover");
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("breadcrumb blur did not clear source hover");
    }

    const nodeCodeButton = graphRoot.querySelector<HTMLButtonElement>(".param-title-actions .param-code-link");
    if (!nodeCodeButton) {
      verifyErrors.push("selected node has no code icon button");
    } else {
      if (nodeCodeButton.getAttribute("aria-keyshortcuts") !== "C") {
        verifyErrors.push("node code icon did not advertise code reveal shortcut");
      }
      nodeCodeButton.click();
      if (revealedSource !== "sphere:call") verifyErrors.push(`node code icon emitted ${revealedSource || "nothing"}`);
    }
    const paramTitleEye = graphRoot.querySelector<HTMLButtonElement>(".param-title-actions .param-visibility");
    if (!paramTitleEye) {
      verifyErrors.push("selected node has no parameter-panel eye visibility toggle");
    } else {
      if (paramTitleEye.title !== "Hide this shape in preview (V; Alt-click isolates branch)") {
        verifyErrors.push(`parameter-panel eye had unclear title ${paramTitleEye.title || "nothing"}`);
      }
      paramTitleEye.click();
      if (hiddenEvents.at(-1)?.[0] !== sphere.id) {
        verifyErrors.push("parameter-panel eye visibility toggle did not hide selected node");
      }
      const hiddenParamTitleEye = graphRoot.querySelector<HTMLButtonElement>(".param-title-actions .param-visibility");
      if (hiddenParamTitleEye?.dataset.state !== "hidden") {
        verifyErrors.push(`parameter-panel eye hidden state rendered ${hiddenParamTitleEye?.dataset.state || "nothing"}`);
      }
      hiddenParamTitleEye?.click();
      if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) {
        verifyErrors.push("parameter-panel eye did not restore selected node visibility");
      }
    }

    const paramIsolate = graphRoot.querySelector<HTMLButtonElement>(".param-title-actions .param-isolate");
    if (!paramIsolate) {
      verifyErrors.push("selected node has no parameter-panel isolate button");
    } else {
      if (!paramIsolate.querySelector(".isolate-icon")) {
        verifyErrors.push("parameter-panel isolate button rendered without icon");
      }
      if (paramIsolate.getAttribute("aria-keyshortcuts") !== "I") {
        verifyErrors.push("parameter-panel isolate shortcut missing");
      }
      if (paramIsolate.getAttribute("aria-label") !== "Isolate selected node in preview") {
        verifyErrors.push(`parameter-panel isolate label was ${paramIsolate.getAttribute("aria-label") || "missing"}`);
      }
      paramIsolate.click();
      const pressedParamIsolate = graphRoot.querySelector<HTMLButtonElement>(".param-title-actions .param-isolate");
      if (pressedParamIsolate?.getAttribute("aria-pressed") !== "true") {
        verifyErrors.push("parameter-panel isolate did not render pressed state");
      }
      if (!soloLabels.at(-1)?.includes("sphere")) {
        verifyErrors.push("parameter-panel isolate did not emit solo preview");
      }
      pressedParamIsolate?.click();
      if ((soloLabels.at(-1) ?? "not-cleared") !== "") {
        verifyErrors.push("parameter-panel isolate did not clear solo preview");
      }
    }

    const mapToggle = graphRoot.querySelector<HTMLButtonElement>(".graph-map-toggle");
    if (!mapToggle) {
      verifyErrors.push("graph map toggle not found");
    } else {
      mapToggle.click();
      const mapEye = graphRoot.querySelector<SVGElement>(`.graph-map-node[data-node-id="${sphere.id}"] .graph-map-eye`);
      const mapNodeShortcuts = graphRoot
        .querySelector<SVGElement>(`.graph-map-node[data-node-id="${sphere.id}"]`)
        ?.getAttribute("aria-keyshortcuts") ?? "";
      if (!mapNodeShortcuts.includes("C") || !mapNodeShortcuts.includes("I") || !mapNodeShortcuts.includes("Shift+V")) {
        verifyErrors.push(`graph map node shortcuts rendered ${mapNodeShortcuts || "nothing"}`);
      }
      if (!mapEye) {
        verifyErrors.push("selected sphere has no map eye visibility toggle");
      } else {
        if (mapEye.getAttribute("aria-keyshortcuts") !== "V") verifyErrors.push("map eye visibility shortcut missing");
        mapEye.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        if (hiddenEvents.at(-1)?.[0] !== sphere.id) verifyErrors.push("map eye visibility toggle did not hide sphere");
      }
      const showAll = graphRoot.querySelector<HTMLButtonElement>(".graph-show-all");
      if (!showAll || showAll.hidden) {
        verifyErrors.push("show-all visibility control did not appear after hiding a node");
      } else {
        const hiddenCount = showAll.querySelector(".visibility-count")?.textContent;
        if (hiddenCount !== "1") verifyErrors.push(`show-all visibility badge rendered ${hiddenCount || "nothing"}`);
        if (showAll.getAttribute("aria-label") !== "Show 1 hidden node") {
          verifyErrors.push("show-all visibility control had unclear aria label");
        }
        showAll.click();
      }
      if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("show-all after map eye did not clear hidden nodes");
      const mapNode = graphRoot.querySelector<SVGElement>(`.graph-map-node[data-node-id="${sphere.id}"]`);
      if (!mapNode) {
        verifyErrors.push("selected sphere has no map node for source hover");
      } else {
        mapNode.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
        if (sourceHoverLabels.at(-1) !== "sphere:call") {
          verifyErrors.push(`map node hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
        }
        mapNode.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
        if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("map node leave did not clear source hover");
        mapNode.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        if (graphHoverLabels.at(-1) !== sphereHoverLabel) verifyErrors.push("map node focus did not inspect node");
        if (sourceHoverLabels.at(-1) !== "sphere:call") verifyErrors.push("map node focus did not emit source hover");
        mapNode.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        if (graphHoverLabels.at(-1) !== "") verifyErrors.push("map node blur did not clear graph hover");
        if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("map node blur did not clear source hover");
      }
    }

    const radiusInput = graphRoot.querySelector<HTMLInputElement>(".param-row input[type='number']");
    if (!radiusInput) {
      verifyErrors.push("selected sphere has no numeric input");
      return;
    }
    const expectedRadiusValueLabel = `sphere #${sphere.id} radius value`;
    if (radiusInput.getAttribute("aria-label") !== expectedRadiusValueLabel) {
      verifyErrors.push(`radius input label rendered ${radiusInput.getAttribute("aria-label") || "nothing"}`);
    }
    const radiusRange = graphRoot.querySelector<HTMLInputElement>(".param-row input[type='range']");
    const expectedRadiusRangeLabel = `sphere #${sphere.id} radius slider`;
    if (radiusRange?.getAttribute("aria-label") !== expectedRadiusRangeLabel) {
      verifyErrors.push(`radius slider label rendered ${radiusRange?.getAttribute("aria-label") || "nothing"}`);
    }
    const paramCodeButton = graphRoot.querySelector<HTMLButtonElement>(".param-row .param-source-link");
    if (!paramCodeButton) {
      verifyErrors.push("selected sphere radius has no code icon button");
    } else {
      const expectedLabel = `Reveal sphere #${sphere.id} radius in code`;
      if (paramCodeButton.getAttribute("aria-label") !== expectedLabel) {
        verifyErrors.push(`param code icon label rendered ${paramCodeButton.getAttribute("aria-label") || "nothing"}`);
      }
      paramCodeButton.click();
      if (revealedSource !== "sphere:radius") verifyErrors.push(`param code icon emitted ${revealedSource || "nothing"}`);
    }
    const paramRow = graphRoot.querySelector<HTMLElement>(".param-row");
    if (!paramRow) {
      verifyErrors.push("selected sphere has no parameter row");
    } else {
      paramRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "sphere:radius") verifyErrors.push(`param row hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
      if (!paramRow.classList.contains("source-hovered")) verifyErrors.push("param row hover did not mark itself");
      paramRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("param row leave did not clear source hover");
      if (paramRow.classList.contains("source-hovered")) verifyErrors.push("param row leave kept local hover");
      paramRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "sphere:radius") verifyErrors.push("param row focus did not emit source hover");
      if (!paramRow.classList.contains("source-hovered")) verifyErrors.push("param row focus did not mark itself");
      paramRow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("param row blur did not clear source hover");
      if (paramRow.classList.contains("source-hovered")) verifyErrors.push("param row blur kept local hover");
    }
    const paramName = paramRow?.querySelector<HTMLElement>(".param-name");
    if (!paramName) {
      verifyErrors.push("selected sphere has no scrub handle");
    } else {
      const expectedScrubLabel = `sphere #${sphere.id} radius scrub handle`;
      if (paramName.getAttribute("aria-label") !== expectedScrubLabel) {
        verifyErrors.push(`scrub handle label rendered ${paramName.getAttribute("aria-label") || "nothing"}`);
      }
      if (paramName.getAttribute("aria-keyshortcuts") !== "ArrowLeft ArrowRight ArrowUp ArrowDown") {
        verifyErrors.push("scrub handle did not advertise arrow key shortcuts");
      }
      paramName.dispatchEvent(new FocusEvent("focus"));
      paramName.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      paramName.dispatchEvent(new FocusEvent("blur"));
      const keyboardValue = Number(radiusInput.value);
      if (!lastEdit || lastEdit.nodeId !== sphere.id || lastEdit.label !== "radius" || keyboardValue <= 1) {
        verifyErrors.push(`keyboard scrub emitted ${lastEdit?.label ?? "nothing"} ${keyboardValue}`);
      }
    }
    const rangeBounds = Array.from(paramRow?.querySelectorAll<HTMLElement>(".param-range-bound") ?? [])
      .map((bound) => bound.textContent ?? "");
    if (rangeBounds.join(":") !== "0:2.5") {
      verifyErrors.push(`radius range bounds rendered ${rangeBounds.join(":") || "nothing"}`);
    }
    const radiusSourceLink = sourceLinks.find((link) => {
      return link.nodeId === sphere.id && link.label === "radius" && link.end > link.start;
    });
    if (!radiusSourceLink) {
      verifyErrors.push("selected sphere radius has no source link");
    } else {
      graphInspector.setHoveredSourceLink(radiusSourceLink);
      if (!graphRoot.querySelector(".param-row.source-hovered")) {
        verifyErrors.push("source hover did not mark matching param row");
      }
      graphInspector.setHoveredSourceLink(null);
      if (graphRoot.querySelector(".param-row.source-hovered")) {
        verifyErrors.push("clearing source hover left a param row marked");
      }
    }
    radiusInput.dispatchEvent(new FocusEvent("focus"));
    radiusInput.value = "1.2";
    radiusInput.dispatchEvent(new Event("input", { bubbles: true }));
    radiusInput.dispatchEvent(new FocusEvent("blur"));
    if (!lastEdit || lastEdit.nodeId !== sphere.id || lastEdit.label !== "radius" || lastEdit.nextValue !== 1.2) {
      verifyErrors.push("numeric param edit did not emit expected graph edit");
    } else {
      const updatedRangeBounds = Array.from(paramRow?.querySelectorAll<HTMLElement>(".param-range-bound") ?? [])
        .map((bound) => bound.textContent ?? "");
      if (updatedRangeBounds.join(":") !== "0:3") {
        verifyErrors.push(`radius range bounds did not recenter after edit: ${updatedRangeBounds.join(":") || "nothing"}`);
      }
      graphInspector.setDirtyParams([lastEdit]);
      if (!graphRoot.querySelector(".graph-node.edited")) verifyErrors.push("dirty graph node marker did not render");
      if (!graphRoot.querySelector(".param-row.edited")) verifyErrors.push("dirty param row marker did not render");
    }

    let nodeButton = graphRoot.querySelector<HTMLButtonElement>(`.graph-node[data-node-id="${sphere.id}"]`);
    if (!nodeButton) {
      verifyErrors.push("selected sphere node button not found");
      return;
    }

    const nodeRow = nodeButton.closest<HTMLElement>(".graph-node-row");
    if (!nodeRow) {
      verifyErrors.push("selected sphere node row not found");
    } else {
      nodeRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "sphere:call") {
        verifyErrors.push(`tree node hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
      }
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      if (graphHoverLabels.at(-1) !== sphereHoverLabel || hoverEvents.at(-1)?.shiftKey !== true) {
        verifyErrors.push("tree node Shift keydown did not focus hovered node");
      }
      if (!graphRoot.querySelector(`.graph-node[data-node-id="${sphere.id}"].focus-peek`)) {
        verifyErrors.push("tree node Shift keydown did not mark focused graph row");
      }
      if (!graphRoot.querySelector(`.graph-map-node[data-node-id="${sphere.id}"].focus-peek`)) {
        verifyErrors.push("tree node Shift keydown did not mark focused graph map node");
      }
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
      if (graphHoverLabels.at(-1) !== sphereHoverLabel || hoverEvents.at(-1)?.shiftKey !== false) {
        verifyErrors.push("tree node Shift keyup did not restore normal hover");
      }
      if (graphRoot.querySelector(".graph-node.focus-peek, .graph-map-node.focus-peek")) {
        verifyErrors.push("tree node Shift keyup left focused graph node marked");
      }
      nodeRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("tree node leave did not clear source hover");
      nodeRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== sphereHoverLabel) verifyErrors.push("tree node focus did not inspect node");
      if (sourceHoverLabels.at(-1) !== "sphere:call") verifyErrors.push("tree node focus did not emit source hover");
      nodeRow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      if (graphHoverLabels.at(-1) !== "") verifyErrors.push("tree node blur did not clear graph hover");
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("tree node blur did not clear source hover");
    }

    const rowIsolate = nodeRow?.querySelector<HTMLButtonElement>(".graph-isolate");
    if (!rowIsolate) {
      verifyErrors.push("selected sphere has no row isolate button");
    } else {
      const expectedLabel = `Isolate sphere #${sphere.id} in preview`;
      if (!rowIsolate.querySelector(".isolate-icon")) verifyErrors.push("row isolate button rendered without icon");
      if (rowIsolate.getAttribute("aria-keyshortcuts") !== "I") verifyErrors.push("row isolate shortcut missing");
      if (rowIsolate.getAttribute("aria-label") !== expectedLabel) {
        verifyErrors.push(`row isolate label was ${rowIsolate.getAttribute("aria-label") || "missing"}`);
      }
      rowIsolate.click();
      const pressedNodeButton = graphRoot.querySelector<HTMLButtonElement>(`.graph-node[data-node-id="${sphere.id}"]`);
      const pressedRowIsolate = pressedNodeButton
        ?.closest<HTMLElement>(".graph-node-row")
        ?.querySelector<HTMLButtonElement>(".graph-isolate") ?? null;
      if (pressedRowIsolate?.getAttribute("aria-pressed") !== "true") {
        verifyErrors.push("row isolate did not render pressed state");
      }
      if (!soloLabels.at(-1)?.includes("sphere")) {
        verifyErrors.push("row isolate did not emit solo preview");
      }
      pressedRowIsolate?.click();
      if ((soloLabels.at(-1) ?? "not-cleared") !== "") {
        verifyErrors.push("row isolate did not clear solo preview");
      }
    }

    const visibilityButton = nodeRow?.querySelector<HTMLButtonElement>(".graph-visibility");
    if (!visibilityButton) {
      verifyErrors.push("selected sphere has no eye visibility button");
    } else {
      if (visibilityButton.getAttribute("aria-keyshortcuts") !== "V") verifyErrors.push("tree eye visibility shortcut missing");
      if (!visibilityButton.getAttribute("aria-label")?.includes("preview")) {
        verifyErrors.push("tree eye visibility label did not explain preview effect");
      }
      visibilityButton.click();
      if (hiddenEvents.at(-1)?.[0] !== sphere.id) verifyErrors.push("eye visibility toggle did not hide sphere");
    }

    const hiddenHeaderEye = graphRoot.querySelector<HTMLButtonElement>(".graph-tree-header-eye");
    if (!hiddenHeaderEye || hiddenHeaderEye.disabled) {
      verifyErrors.push("graph tree header eye did not become show-all control");
    } else {
      if (hiddenHeaderEye.querySelector(".visibility-count")?.textContent !== "1") {
        verifyErrors.push("graph tree header eye did not show hidden count");
      }
      if (hiddenHeaderEye.getAttribute("aria-label") !== "Show all hidden graph nodes") {
        verifyErrors.push("graph tree header eye had unclear show-all label");
      }
      hiddenHeaderEye.click();
      if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("graph tree header eye did not clear hidden nodes");
    }

    nodeButton = graphRoot.querySelector<HTMLButtonElement>(`.graph-node[data-node-id="${sphere.id}"]`);
    if (!nodeButton) {
      verifyErrors.push("selected sphere node disappeared after eye toggle");
      return;
    }

    const isolateButton = nodeButton.closest<HTMLElement>(".graph-node-row")?.querySelector<HTMLButtonElement>(".graph-visibility");
    const siblingBranchId = sdf.node.children[1]?.node.id;
    if (!isolateButton) {
      verifyErrors.push("selected sphere has no eye visibility button after restore");
    } else {
      isolateButton.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
      const isolatedHidden = hiddenEvents.at(-1) ?? [];
      if (siblingBranchId == null || !isolatedHidden.includes(siblingBranchId)) {
        verifyErrors.push("Alt-click eye did not isolate by hiding sibling branch");
      }
      if (isolatedHidden.includes(sphere.id)) verifyErrors.push("Alt-click eye hid the isolated sphere");
      if (!isolateButton.title.includes("Alt-click isolates branch")) {
        verifyErrors.push("eye visibility title did not advertise isolate gesture");
      }
      const isolateHeaderEye = graphRoot.querySelector<HTMLButtonElement>(".graph-tree-header-eye");
      isolateHeaderEye?.click();
      if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("show-all after Alt-click isolate did not clear hidden nodes");
    }

    nodeButton = graphRoot.querySelector<HTMLButtonElement>(`.graph-node[data-node-id="${sphere.id}"]`);
    if (!nodeButton) {
      verifyErrors.push("selected sphere node disappeared after isolate restore");
      return;
    }
    nodeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "V", shiftKey: true, bubbles: true }));
    if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("keyboard show-all after eye toggle did not clear hidden nodes");

    nodeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }));
    if (hiddenEvents.at(-1)?.[0] !== sphere.id) verifyErrors.push("keyboard visibility toggle did not hide sphere");
    nodeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "V", shiftKey: true, bubbles: true }));
    if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("keyboard show-all did not clear hidden nodes");

    nodeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    if (!soloLabels.at(-1)?.includes("sphere")) verifyErrors.push("keyboard isolate did not emit sphere solo preview");

    nodeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    if (revealedSource !== "sphere:call") verifyErrors.push(`keyboard code reveal emitted ${revealedSource || "nothing"}`);
  }
}

function verifySharedGraphNodeElementIds(errors: string[]): void {
  const root = document.createElement("div");
  document.body.append(root);
  try {
    const { sdf } = evaluateSource(`
const shared = sphere(0.4)
return union(shared, shared)
`);
    const inspector = new GraphInspector(root, {
      onSelect() {},
      onHover() {},
      onEdit() {},
      onSolo() {},
      onRevealSource() {},
      onSourceHover() {},
      onVisibilityChange() {},
    });
    inspector.setSdf(sdf);

    const ids = [...root.querySelectorAll<HTMLElement>(".graph-node[id]")]
      .map((node) => node.id)
      .filter(Boolean);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      errors.push(`shared graph nodes rendered duplicate element ids: ${[...new Set(duplicateIds)].join(", ")}`);
    }

    const nodeIds = [...root.querySelectorAll<HTMLElement>(".graph-node[data-node-id]")]
      .map((node) => node.dataset.nodeId ?? "");
    const repeatedNodeIds = nodeIds.filter((id, index) => id && nodeIds.indexOf(id) !== index);
    if (repeatedNodeIds.length === 0) {
      errors.push("shared graph node fixture did not render a repeated data-node-id");
    }
  } finally {
    root.remove();
  }
}
