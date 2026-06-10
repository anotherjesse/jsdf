import type { Node, SDF3 } from "../core/nodes";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphEditHistory } from "../editor/graph-history";
import { GraphInspector, type GraphParamEdit } from "../editor/graph-inspector";

export interface GraphRuntimeVerification {
  ok: boolean;
  nodes: number;
  eyeButtons: number;
  mapEyes: number;
  links: number;
  selectedNode: string;
  editedRows: number;
  hiddenEvents: number[][];
  revealedSource: string;
  soloLabels: string[];
  sourcePatch: string;
  history: {
    sameSessionCount: number;
    separateSessionCount: number;
    timedCount: number;
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

  return {
    ok: errors.length === 0,
    nodes: root.querySelectorAll(".graph-node").length,
    eyeButtons: root.querySelectorAll(".graph-visibility").length,
    mapEyes: root.querySelectorAll(".graph-map-eye").length,
    links: links.length,
    selectedNode,
    editedRows: root.querySelectorAll(".param-row.edited, .axis-control.edited").length,
    hiddenEvents,
    revealedSource,
    soloLabels,
    sourcePatch: verifySourcePatch(lastEdit, sdf, errors),
    history,
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
    if (sourceLinks.length < 4) {
      verifyErrors.push("source links found too few graph ranges");
    }
    if (!graphInspector.selectNodeById(sphere.id)) {
      verifyErrors.push("could not select sphere node");
      return;
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
