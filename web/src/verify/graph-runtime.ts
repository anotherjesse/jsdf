import type { Node, SDF3 } from "../core/nodes";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import { renderGraphChangeJournal } from "../editor/graph-change-journal";
import { GraphEditHistory, formatGraphChangeValue } from "../editor/graph-history";
import { GraphInspector, type GraphParamEdit } from "../editor/graph-inspector";
import { scrubNumericParamValue } from "../editor/scrub-values";
import { renderSourceDialog } from "../editor/source-dialog";
import {
  clearSourceDraft,
  listSavedSourceDocuments,
  loadSavedSourceVersion,
  loadSourceDraft,
  saveSourceDraft,
  saveSourceVersion,
  type SavedSourceDocument,
  type SavedSourcePreview,
} from "../editor/workspace-storage";
import { examples } from "../examples";

export interface GraphRuntimeVerification {
  ok: boolean;
  nodes: number;
  treeHeaders: number;
  eyeButtons: number;
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
  scrubValues: {
    count: number;
    smallRadius: number;
    fineRadius: number;
  };
  history: {
    sameSessionCount: number;
    separateSessionCount: number;
    timedCount: number;
    changeLabel: string;
  };
  changeJournal: {
    hiddenWhenEmpty: boolean;
    renderedRows: number;
    overflowText: string;
    hoverShift: boolean;
    clearCount: number;
    revealSource: boolean;
  };
  sourceDialog: {
    initialCards: number;
    chainMatches: string[];
    savedMatches: string[];
    emptyMessages: string[];
    loadedExample: string;
    loadedSaved: string;
  };
  workspaceStorage: {
    savedHiddenKeys: string[];
    draftHiddenKeys: string[];
    normalizedHiddenKeys: string[];
    savedLayout: string;
    draftLayout: string;
    legacyLayout: string;
    draftCleared: boolean;
  };
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

  return {
    ok: errors.length === 0,
    nodes: root.querySelectorAll(".graph-node").length,
    treeHeaders: root.querySelectorAll(".graph-tree-header").length,
    eyeButtons: root.querySelectorAll(".graph-visibility").length,
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
    sourcePatch: verifySourcePatch(lastEdit, sdf, errors),
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
    const sphereHoverLabel = `${sphere.kind} #${sphere.id}`;

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
      filterInput.value = "radius";
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (!graphRoot.querySelector(".param-row.matched")) {
        verifyErrors.push("filter did not mark matching radius param row");
      }
      filterInput.value = "";
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (graphRoot.querySelector(".param-row.matched")) {
        verifyErrors.push("clearing filter left matched param row marked");
      }
    }

    const currentCrumb = graphRoot.querySelector<HTMLElement>(".param-breadcrumb button[aria-current='page']");
    if (!currentCrumb) {
      verifyErrors.push("selected sphere has no current breadcrumb crumb");
    } else {
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
      nodeCodeButton.click();
      if (revealedSource !== "sphere:call") verifyErrors.push(`node code icon emitted ${revealedSource || "nothing"}`);
    }

    const mapToggle = graphRoot.querySelector<HTMLButtonElement>(".graph-map-toggle");
    if (!mapToggle) {
      verifyErrors.push("graph map toggle not found");
    } else {
      mapToggle.click();
      const mapEye = graphRoot.querySelector<SVGElement>(`.graph-map-node[data-node-id="${sphere.id}"] .graph-map-eye`);
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
    const paramCodeButton = graphRoot.querySelector<HTMLButtonElement>(".param-row .param-source-link");
    if (!paramCodeButton) {
      verifyErrors.push("selected sphere radius has no code icon button");
    } else {
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

function verifySourceDialog(errors: string[]): GraphRuntimeVerification["sourceDialog"] {
  const root = document.createElement("div");
  const savedDocuments: SavedSourceDocument[] = [{
    id: "saved-vessel",
    name: "Saved Vessel",
    updatedAt: "2026-06-10T09:00:00.000Z",
    versions: [
      { id: "version-latest", createdAt: "2026-06-10T09:00:00.000Z", source: "return sphere(1)" },
      { id: "version-old", createdAt: "2026-06-09T09:00:00.000Z", source: "return box(1)" },
    ],
  }];
  let loadedExample = "";
  let loadedSaved = "";

  renderSourceDialog(root, {
    examples,
    savedDocuments,
    activeExampleId: examples[0]?.id ?? "",
    activeDocumentId: null,
    activeVersionId: null,
  }, {
    loadExample(id) {
      loadedExample = id;
    },
    loadSaved(documentId, versionId) {
      loadedSaved = `${documentId}:${versionId}`;
    },
    deleteDocument() {},
    deleteVersion() {},
  });

  const search = root.querySelector<HTMLInputElement>(".source-search-input");
  if (!search) {
    errors.push("source dialog search input did not render");
    return {
      initialCards: 0,
      chainMatches: [],
      savedMatches: [],
      emptyMessages: [],
      loadedExample,
      loadedSaved,
    };
  }

  const initialCards = sourceCardLabels(root).length;
  if (initialCards < examples.length + savedDocuments.length) {
    errors.push(`source dialog rendered too few cards: ${initialCards}`);
  }

  search.value = "chain";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const chainMatches = sourceCardLabels(root);
  if (!chainMatches.includes("Chain links")) errors.push("source dialog search did not find Chain links");
  if (chainMatches.includes("CSG example")) errors.push("source dialog search left unrelated example visible");
  clickSourceCard(root, "Chain links");
  if (loadedExample !== "chain") errors.push(`source dialog example load emitted ${loadedExample || "nothing"}`);

  search.value = "vessel";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const savedMatches = sourceCardLabels(root);
  if (!savedMatches.includes("Saved Vessel")) errors.push("source dialog search did not find saved shape");
  clickSourceCard(root, "Saved Vessel");
  if (loadedSaved !== "saved-vessel:version-latest") {
    errors.push(`source dialog saved load emitted ${loadedSaved || "nothing"}`);
  }

  search.value = "zzzzzzz";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const emptyMessages = [...root.querySelectorAll<HTMLElement>(".source-empty")].map((item) => item.textContent ?? "");
  if (!emptyMessages.includes("No matching examples")) errors.push("source dialog missing no matching examples state");
  if (!emptyMessages.includes("No saved shapes match")) errors.push("source dialog missing no saved matches state");

  return {
    initialCards,
    chainMatches,
    savedMatches,
    emptyMessages,
    loadedExample,
    loadedSaved,
  };
}

function verifyWorkspaceStorage(errors: string[]): GraphRuntimeVerification["workspaceStorage"] {
  const storage = new MemoryStorage();
  const normalizedHiddenKeys = ["box:call:20:26", "sphere:call:6:15"];
  const preview: SavedSourcePreview = {
    bounds: [[-1, -1, -1], [1, 1, 1]],
    meshGrid: 128,
    raySteps: 192,
    meshAlgorithm: "surface-net",
    layout: "quad",
    hiddenNodeKeys: [" sphere:call:6:15 ", "box:call:20:26", "sphere:call:6:15", "", " "],
  };

  const saved = saveSourceVersion("Visibility test", "return sphere(1)", null, preview, storage);
  const loaded = loadSavedSourceVersion(saved.id, null, storage);
  const savedHiddenKeys = loaded?.version.preview?.hiddenNodeKeys ?? [];
  const savedLayout = loaded?.version.preview?.layout ?? "";
  if (!sameStrings(savedHiddenKeys, normalizedHiddenKeys)) {
    errors.push(`saved hidden keys normalized to ${savedHiddenKeys.join(",") || "nothing"}`);
  }
  if (savedLayout !== "quad") errors.push(`saved layout normalized to ${savedLayout || "nothing"}`);

  saveSourceDraft({
    name: "Visibility draft",
    source: "return box(1)",
    preview,
    activeDocumentId: saved.id,
    activeVersionId: loaded?.version.id ?? null,
    activeExampleId: "canonical",
  }, storage);
  const draftPreview = loadSourceDraft(storage)?.preview;
  const draftHiddenKeys = draftPreview?.hiddenNodeKeys ?? [];
  const draftLayout = draftPreview?.layout ?? "";
  if (!sameStrings(draftHiddenKeys, normalizedHiddenKeys)) {
    errors.push(`draft hidden keys normalized to ${draftHiddenKeys.join(",") || "nothing"}`);
  }
  if (draftLayout !== "quad") errors.push(`draft layout normalized to ${draftLayout || "nothing"}`);

  saveSourceVersion("Legacy layout", "return sphere(1)", null, {
    bounds: [[-1, -1, -1], [1, 1, 1]],
    meshGrid: 64,
    raySteps: 176,
    meshAlgorithm: "surface-net",
  } as SavedSourcePreview, storage);
  const legacy = listSavedSourceDocuments(storage).find((document) => document.name === "Legacy layout");
  const legacyLayout = legacy ? loadSavedSourceVersion(legacy.id, null, storage)?.version.preview?.layout ?? "" : "";
  if (legacyLayout !== "single") errors.push(`legacy layout normalized to ${legacyLayout || "nothing"}`);

  clearSourceDraft(storage);
  const draftCleared = loadSourceDraft(storage) == null;
  if (!draftCleared) errors.push("clearing source draft left saved visibility draft behind");

  return {
    savedHiddenKeys,
    draftHiddenKeys,
    normalizedHiddenKeys,
    savedLayout,
    draftLayout,
    legacyLayout,
    draftCleared,
  };
}

function verifyOrientationControl(errors: string[]): void {
  const root = document.createElement("div");
  const { sdf } = evaluateSource("return cylinder(0.25).orient(X)");
  const links = findGraphSourceLinks("return cylinder(0.25).orient(X)", sdf);
  const sourceHoverLabels: string[] = [];
  const edits: GraphParamEdit[] = [];
  let revealedSource = "";
  const inspector = new GraphInspector(root, {
    onSelect() {},
    onHover() {},
    onEdit(edit) {
      edits.push(edit);
    },
    onSolo() {},
    onRevealSource(link) {
      revealedSource = `${link.nodeKind}:${link.label}`;
    },
    onSourceHover(link) {
      sourceHoverLabels.push(link ? `${link.nodeKind}:${link.label}` : "");
    },
    onVisibilityChange() {},
  });

  inspector.setSdf(sdf);
  inspector.setSourceLinks(links);
  const rotate = findNodeByKind(sdf.node, "rotate3");
  if (!rotate) {
    errors.push("orientation fixture produced no rotate3 node");
    return;
  }
  inspector.selectNodeById(rotate.id);

  const axis = root.querySelector<HTMLElement>(".axis-control");
  const axisLink = links.find((link) => link.nodeId === rotate.id && link.label === "axis");
  if (!axis) {
    errors.push("orientation control did not render for rotate3 node");
    return;
  }
  if (!axisLink) {
    errors.push("orientation control had no source axis link");
    return;
  }

  axis.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "rotate3:axis") {
    errors.push(`orientation hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
  }
  if (!axis.classList.contains("source-hovered")) errors.push("orientation hover did not mark itself");
  axis.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "") errors.push("orientation leave did not clear source hover");
  if (axis.classList.contains("source-hovered")) errors.push("orientation leave kept local hover");

  axis.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "rotate3:axis") errors.push("orientation focus did not emit source hover");
  if (!axis.classList.contains("source-hovered")) errors.push("orientation focus did not mark itself");
  axis.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "") errors.push("orientation blur did not clear source hover");
  if (axis.classList.contains("source-hovered")) errors.push("orientation blur kept local hover");

  inspector.setHoveredSourceLink(axisLink);
  if (!root.querySelector(".axis-control.source-hovered")) errors.push("source hover did not mark orientation control");
  inspector.setHoveredSourceLink(null);
  if (root.querySelector(".axis-control.source-hovered")) errors.push("clearing source hover left orientation marked");

  const customButton = [...axis.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Custom");
  if (!customButton) {
    errors.push("orientation control had no custom matrix button");
    return;
  }
  customButton.click();

  const matrixControl = root.querySelector<HTMLElement>(".matrix-control");
  const matrixInputs = [...root.querySelectorAll<HTMLInputElement>(".matrix-grid input")];
  if (!matrixControl) {
    errors.push("custom orientation did not render matrix grid");
    return;
  }
  if (matrixInputs.length !== 9) {
    errors.push(`custom orientation rendered ${matrixInputs.length} matrix inputs`);
  }

  const matrixSourceButton = matrixControl.querySelector<HTMLButtonElement>(".matrix-source-link");
  if (!matrixSourceButton) {
    errors.push("custom orientation matrix had no source reveal button");
  } else {
    matrixSourceButton.click();
    if (revealedSource !== "rotate3:axis") errors.push(`matrix source reveal emitted ${revealedSource || "nothing"}`);
  }

  const firstOffDiagonal = matrixInputs[1];
  if (!firstOffDiagonal) return;
  firstOffDiagonal.dispatchEvent(new FocusEvent("focus"));
  firstOffDiagonal.value = "0.25";
  firstOffDiagonal.dispatchEvent(new Event("input", { bubbles: true }));
  firstOffDiagonal.dispatchEvent(new FocusEvent("blur"));
  const lastEdit = edits.at(-1);
  if (!lastEdit || lastEdit.nodeId !== rotate.id || lastEdit.label !== "matrix[0][1]" || lastEdit.nextValue !== 0.25) {
    errors.push(`custom matrix edit emitted ${lastEdit ? `${lastEdit.label}:${String(lastEdit.nextValue)}` : "nothing"}`);
  }
  if (inspector.getParamValue(rotate.id, ["matrix", 0, 1]) !== 0.25) {
    errors.push("custom matrix edit did not update graph param");
  }
}

function sourceCardLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".source-card strong, .source-version-button strong")]
    .map((item) => item.textContent ?? "");
}

function clickSourceCard(root: HTMLElement, label: string): void {
  const target = [...root.querySelectorAll<HTMLButtonElement>(".source-card, .source-version-button")]
    .find((button) => button.querySelector("strong")?.textContent === label);
  target?.click();
}

function verifySourcePatch(edit: GraphParamEdit | null, sdf: SDF3, errors: string[]): string {
  if (!edit) {
    errors.push("source patch verification had no graph edit");
    return "";
  }
  const nextSource = patchGraphEditSource(fixtureSource, sdf, edit, edit.nextValue);
  if (!nextSource) {
    errors.push("source patch verification did not patch source");
    return "";
  }
  if (!nextSource.includes("sphere(1.2)")) {
    errors.push("source patch verification did not update sphere literal");
  }
  const patchedLinks = findGraphSourceLinks(nextSource, sdf);
  const radiusLink = patchedLinks.find((link) => {
    return link.nodeId === edit.nodeId && link.label === "radius" && link.end > link.start;
  });
  if (!radiusLink) {
    errors.push("source patch verification did not rediscover edited radius link");
  } else if (nextSource.slice(radiusLink.start, radiusLink.end) !== "1.2") {
    errors.push("source patch verification radius link points at wrong text");
  }
  return nextSource.trim();
}

function verifyVectorSourcePatches(errors: string[]): string[] {
  const patches = [
    verifyMulAxisScalarPatch(errors),
    verifyMulOffAxisMaterialization(errors),
    verifyDirectAxisExpansion(errors),
  ].filter((source): source is string => Boolean(source));
  return patches;
}

function verifyMulAxisScalarPatch(errors: string[]): string | null {
  const source = "return sphere(1).translate(mul(Z, -3))";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("mul axis scalar fixture did not produce translate offset");
    return null;
  }
  offset[2] = -2.5;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 2], "offset[2]", -3, -2.5), -2.5);
  if (!patched) {
    errors.push("mul axis scalar patch did not patch source");
    return null;
  }
  if (!patched.includes("mul(Z, -2.5)")) {
    errors.push("mul axis scalar patch did not preserve mul(Z, value)");
  }
  return patched;
}

function verifyMulOffAxisMaterialization(errors: string[]): string | null {
  const source = "return sphere(1).translate(mul(Z, -3))";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("mul off-axis fixture did not produce translate offset");
    return null;
  }
  offset[0] = 1.25;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", 0, 1.25), 1.25);
  if (!patched) {
    errors.push("mul off-axis patch did not patch source");
    return null;
  }
  if (!patched.includes("translate([1.25, 0, -3])")) {
    errors.push("mul off-axis patch did not materialize full vector");
  }
  const links = findGraphSourceLinks(patched, sdf);
  const link = links.find((candidate) => candidate.nodeId === translate.id && candidate.label === "offset[0]");
  if (!link || patched.slice(link.start, link.end) !== "1.25") {
    errors.push("mul off-axis patch did not rediscover materialized offset[0]");
  }
  return patched;
}

function verifyDirectAxisExpansion(errors: string[]): string | null {
  const source = "return sphere(1).translate(X)";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("direct axis fixture did not produce translate offset");
    return null;
  }
  offset[0] = 2;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", 1, 2), 2);
  if (!patched) {
    errors.push("direct axis patch did not patch source");
    return null;
  }
  if (!patched.includes("translate(mul(X, 2))")) {
    errors.push("direct axis patch did not expand to mul(X, value)");
  }
  return patched;
}

function vectorParam(node: Node | null, key: string): number[] | null {
  const value = node?.params[key];
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? value : null;
}

function verifyScrubValues(errors: string[]): GraphRuntimeVerification["scrubValues"] {
  const count = scrubNumericParamValue("count", 8, 0.49, { altKey: false, shiftKey: false });
  const smallRadius = scrubNumericParamValue("radius", 0.2, 20, { altKey: false, shiftKey: false });
  const fineRadius = scrubNumericParamValue("radius", 0.2, 20, { altKey: true, shiftKey: false });

  if (count !== 8) errors.push(`count scrub should stay integral near threshold: ${count}`);
  if (!closeTo(smallRadius, 0.3)) errors.push(`small radius scrub value ${smallRadius} !== 0.3`);
  if (!closeTo(fineRadius, 0.21)) errors.push(`fine radius scrub value ${fineRadius} !== 0.21`);

  return { count, smallRadius, fineRadius };
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function graphEdit(
  node: Node,
  path: Array<string | number>,
  label: string,
  previousValue: number,
  nextValue: number,
): GraphParamEdit {
  return {
    node,
    nodeId: node.id,
    nodeKind: node.kind,
    path,
    label,
    previousValue,
    nextValue,
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function verifyHistoryCoalescing(errors: string[]): GraphRuntimeVerification["history"] {
  const sameSession = new GraphEditHistory();
  sameSession.record(edit("session-a", 1, 1.1), 0);
  sameSession.record(edit("session-a", 1.1, 1.2), 2000);
  if (sameSession.dirtyCount !== 1) errors.push(`same-session scrub history count ${sameSession.dirtyCount} !== 1`);

  const separateSession = new GraphEditHistory();
  separateSession.record(edit("session-a", 1, 1.1), 0);
  separateSession.record(edit("session-b", 1.1, 1.2), 100);
  if (separateSession.dirtyCount !== 2) errors.push(`separate-session history count ${separateSession.dirtyCount} !== 2`);

  const timed = new GraphEditHistory();
  timed.record(edit(undefined, 1, 1.1), 0);
  timed.record(edit(undefined, 1.1, 1.2), 100);
  if (timed.dirtyCount !== 1) errors.push(`timed edit history count ${timed.dirtyCount} !== 1`);
  const changeLabel = formatGraphChangeValue(timed.current()[0]);
  if (changeLabel !== "radius 1 -> 1.2") {
    errors.push(`graph change label rendered ${changeLabel}`);
  }

  return {
    sameSessionCount: sameSession.dirtyCount,
    separateSessionCount: separateSession.dirtyCount,
    timedCount: timed.dirtyCount,
    changeLabel,
  };
}

function verifyChangeJournal(errors: string[]): GraphRuntimeVerification["changeJournal"] {
  const emptyRoot = document.createElement("div");
  const noopOptions = {
    entries: [],
    sourceLinkForEntry: () => null,
    onSelect: () => {},
    onHover: () => {},
    onClearHover: () => {},
  };
  renderGraphChangeJournal(emptyRoot, noopOptions);
  const hiddenWhenEmpty = emptyRoot.hidden;
  if (!hiddenWhenEmpty) errors.push("empty graph change journal stayed visible");

  const history = new GraphEditHistory();
  history.record(edit("journal-1", 1, 1.1), 0);
  history.record(edit("journal-2", 1.1, 1.2), 10);
  history.record(edit("journal-3", 1.2, 1.3), 20);
  history.record(edit("journal-4", 1.3, 1.4), 30);

  const root = document.createElement("div");
  const hoverEvents: Array<{ id: number; shiftKey: boolean }> = [];
  const selections: Array<{ id: number; revealSource?: boolean }> = [];
  let clearCount = 0;
  renderGraphChangeJournal(root, {
    entries: history.current(),
    sourceLinkForEntry: (entry) => ({
      nodeId: entry.nodeId,
      nodeKind: entry.nodeKind,
      path: entry.path,
      label: entry.label,
      start: 0,
      end: 6,
    }),
    onSelect(entry, options) {
      selections.push({ id: entry.id, revealSource: options.revealSource });
    },
    onHover(entry, options) {
      hoverEvents.push({ id: entry.id, shiftKey: options.shiftKey });
    },
    onClearHover() {
      clearCount += 1;
    },
  });

  const renderedRows = root.querySelectorAll(".change-entry-row").length;
  const overflowText = root.querySelector(".change-journal-more")?.textContent ?? "";
  if (renderedRows !== 3) errors.push(`graph change journal rendered ${renderedRows} visible rows`);
  if (overflowText !== "+1") errors.push(`graph change journal overflow rendered ${overflowText || "nothing"}`);
  const firstRow = root.querySelector<HTMLElement>(".change-entry-row");
  firstRow?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, shiftKey: true }));
  firstRow?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  root.querySelector<HTMLButtonElement>(".change-entry-source")?.click();

  const hoverShift = hoverEvents.at(-1)?.shiftKey === true;
  const revealSource = selections.at(-1)?.revealSource === true;
  if (!hoverShift) errors.push("graph change journal hover did not preserve shift focus");
  if (clearCount !== 1) errors.push(`graph change journal clear count ${clearCount} !== 1`);
  if (!revealSource) errors.push("graph change journal source button did not request reveal");

  return {
    hiddenWhenEmpty,
    renderedRows,
    overflowText,
    hoverShift,
    clearCount,
    revealSource,
  };
}

function edit(editSessionId: string | undefined, previousValue: number, nextValue: number): GraphParamEdit {
  return {
    node: { id: 100, dim: 3, kind: "sphere", params: {}, children: [] },
    nodeId: 100,
    nodeKind: "sphere",
    path: ["radius"],
    label: "radius",
    previousValue,
    nextValue,
    ...(editSessionId ? { editSessionId } : {}),
  };
}

function findNodeByKind(root: Node, kind: string, visited = new Set<number>()): Node | null {
  if (root.kind === kind) return root;
  if (visited.has(root.id)) return null;
  visited.add(root.id);
  for (const child of root.children) {
    const found = findNodeByKind(child.node, kind, visited);
    if (found) return found;
  }
  return null;
}
