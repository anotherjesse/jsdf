import type { Node, SDF3 } from "../core/nodes";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphEditHistory } from "../editor/graph-history";
import { GraphInspector, type GraphParamEdit } from "../editor/graph-inspector";
import { renderSourceDialog } from "../editor/source-dialog";
import type { SavedSourceDocument } from "../editor/workspace-storage";
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
  sourceHoverLabels: string[];
  revealedSource: string;
  soloLabels: string[];
  sourcePatch: string;
  vectorSourcePatches: string[];
  history: {
    sameSessionCount: number;
    separateSessionCount: number;
    timedCount: number;
  };
  sourceDialog: {
    initialCards: number;
    chainMatches: string[];
    savedMatches: string[];
    emptyMessages: string[];
    loadedExample: string;
    loadedSaved: string;
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
  const sourceHoverLabels: string[] = [];
  const soloLabels: string[] = [];
  let selectedNode = "";
  let revealedSource = "";
  let lastEdit: GraphParamEdit | null = null;

  const inspector = new GraphInspector(root, {
    onSelect(node) {
      selectedNode = node ? `${node.kind} #${node.id}` : "";
    },
    onHover() {},
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
    verifyInspector(root, inspector, sphereNode, links, errors);
  }

  const history = verifyHistoryCoalescing(errors);
  const sourceDialog = verifySourceDialog(errors);

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
    sourceHoverLabels,
    revealedSource,
    soloLabels,
    sourcePatch: verifySourcePatch(lastEdit, sdf, errors),
    vectorSourcePatches: verifyVectorSourcePatches(errors),
    history,
    sourceDialog,
    errors,
  };

  function verifyInspector(
    graphRoot: HTMLElement,
    graphInspector: GraphInspector,
    sphere: Node,
    sourceLinks: GraphSourceLink[],
    verifyErrors: string[],
  ): void {
    if (graphRoot.querySelectorAll(".graph-node").length < 4) {
      verifyErrors.push("graph tree rendered too few nodes");
    }
    if (graphRoot.querySelectorAll(".graph-tree-header").length !== 1) {
      verifyErrors.push("graph tree visibility header did not render");
    }
    if (sourceLinks.length < 4) {
      verifyErrors.push("source links found too few graph ranges");
    }
    if (!graphInspector.selectNodeById(sphere.id)) {
      verifyErrors.push("could not select sphere node");
      return;
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
        mapEye.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        if (hiddenEvents.at(-1)?.[0] !== sphere.id) verifyErrors.push("map eye visibility toggle did not hide sphere");
      }
      graphRoot.querySelector<HTMLButtonElement>(".graph-show-all")?.click();
      if ((hiddenEvents.at(-1)?.length ?? -1) !== 0) verifyErrors.push("show-all after map eye did not clear hidden nodes");
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
      paramRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("param row leave did not clear source hover");
      paramRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "sphere:radius") verifyErrors.push("param row focus did not emit source hover");
      paramRow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      if (sourceHoverLabels.at(-1) !== "") verifyErrors.push("param row blur did not clear source hover");
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

    const visibilityButton = nodeButton.closest(".graph-node-row")?.querySelector<HTMLButtonElement>(".graph-visibility");
    if (!visibilityButton) {
      verifyErrors.push("selected sphere has no eye visibility button");
    } else {
      visibilityButton.click();
      if (hiddenEvents.at(-1)?.[0] !== sphere.id) verifyErrors.push("eye visibility toggle did not hide sphere");
    }

    nodeButton = graphRoot.querySelector<HTMLButtonElement>(`.graph-node[data-node-id="${sphere.id}"]`);
    if (!nodeButton) {
      verifyErrors.push("selected sphere node disappeared after eye toggle");
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

  return {
    sameSessionCount: sameSession.dirtyCount,
    separateSessionCount: separateSession.dirtyCount,
    timedCount: timed.dirtyCount,
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
