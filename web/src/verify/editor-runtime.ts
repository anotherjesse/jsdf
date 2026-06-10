import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { createCodeEditor } from "../editor/code-editor";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";
import {
  graphNodeSourceIdentityForNode,
  graphSourceLinkIdentityForLink,
  sourceLinkForGraphNodeIdentity,
  sourceLinkForGraphSourceLinkIdentity,
} from "../editor/graph-source-identity";
import { readSourceLinkNumber, scrubSourceLinkValue } from "../editor/source-link-scrub";
import type { SDF3 } from "../core/nodes";

const fixtureSource = `
const left = sphere(1).translate([-0.45, 0, 0])
const right = box(0.8).translate([0.45, 0, 0])
return left.union(right, { k: 0.12 })
`;

export interface EditorRuntimeVerification {
  ok: boolean;
  links: number;
  cursorEvents: string[];
  selectedNode: string;
  selectedSourceDecorations: number;
  selectedGraphParams: number;
  selectedGraphTitles: number;
  graphSelections: string[];
  graphRevealEvents: string[];
  graphSourceHoverEvents: string[];
  graphSourceHoverDecorations: number;
  sourceScrub: {
    startValue: number | null;
    nextValue: number | null;
    graphValue: unknown;
    patchedSource: string;
    editedSourceDecorations: number;
    selectedGraphParamsAfterPatch: number;
  };
  selectionRestore: {
    previousNode: string;
    restoredNode: string;
    previousStart: number;
    restoredStart: number;
    previousParam: string;
    restoredParam: string;
    previousParamStart: number;
    restoredParamStart: number;
    selectedParamRows: number;
    selectedNode: string;
  };
  errors: string[];
}

export async function runEditorRuntimeVerification(
  codeRoot: HTMLElement,
  graphRoot: HTMLElement,
): Promise<EditorRuntimeVerification> {
  const errors: string[] = [];
  const cursorEvents: string[] = [];
  const graphSelections: string[] = [];
  const graphRevealEvents: string[] = [];
  const graphSourceHoverEvents: string[] = [];
  const sourceScrub: EditorRuntimeVerification["sourceScrub"] = {
    startValue: null,
    nextValue: null,
    graphValue: null,
    patchedSource: "",
    editedSourceDecorations: 0,
    selectedGraphParamsAfterPatch: 0,
  };
  const selectionRestore = verifySelectionRestore(errors);
  let selectedNode = "";

  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  let codeEditor: ReturnType<typeof createCodeEditor> | null = null;
  const graphInspector = new GraphInspector(graphRoot, {
    onSelect(node) {
      selectedNode = node ? `${node.kind} #${node.id}` : "";
      graphSelections.push(selectedNode);
    },
    onHover() {},
    onEdit() {},
    onSolo() {},
    onRevealSource(link) {
      graphRevealEvents.push(`${link.nodeKind}:${link.label}`);
      graphInspector.setSelectedSourceLink(link);
      codeEditor?.markSelectedSourceLink(link);
      codeEditor?.revealSourceLink(link);
    },
    onSourceHover(link) {
      graphSourceHoverEvents.push(link ? `${link.nodeKind}:${link.label}` : "");
      codeEditor?.markHoveredSourceLink(link);
    },
    onVisibilityChange() {},
  });
  codeEditor = createCodeEditor(
    codeRoot,
    fixtureSource,
    () => {},
    (link) => selectFromSource(link),
    () => {},
    () => {},
    (link) => {
      if (!link) return;
      cursorEvents.push(`${link.nodeKind}:${link.label}`);
      selectFromSource(link);
    },
  );

  try {
    graphInspector.setSdf(sdf);
    graphInspector.setSourceLinks(links);
    codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));

    const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
    if (!radiusLink) {
      errors.push("fixture has no sphere radius source link");
    } else {
      await revealAndSettle(codeEditor, radiusLink);
      if (cursorEvents.at(-1) !== "sphere:radius") {
        errors.push(`cursor over radius emitted ${cursorEvents.at(-1) || "nothing"}`);
      }
      if (!selectedNode.startsWith("sphere #")) {
        errors.push(`radius cursor selected ${selectedNode || "nothing"}`);
      }
      if (graphRoot.querySelectorAll(".param-row.source-selected").length !== 1) {
        errors.push("radius cursor did not mark exactly one graph param row selected");
      }
      const paramCodeButton = graphRoot.querySelector<HTMLButtonElement>(".param-row .param-source-link");
      if (!paramCodeButton) {
        errors.push("selected radius has no graph source reveal button");
      } else {
        paramCodeButton.click();
        await nextFrame();
        if (graphRevealEvents.at(-1) !== "sphere:radius") {
          errors.push(`graph param reveal emitted ${graphRevealEvents.at(-1) || "nothing"}`);
        }
        if (codeRoot.querySelectorAll(".source-revealed-link").length === 0) {
          errors.push("graph param reveal did not mark source as revealed");
        }
        if (codeRoot.querySelectorAll(".source-selected-link").length === 0) {
          errors.push("graph param reveal did not preserve selected source decoration");
        }
        if (graphRoot.querySelectorAll(".param-row.source-selected").length !== 1) {
          errors.push("graph param reveal did not preserve selected graph param");
        }
      }
      const paramRow = graphRoot.querySelector<HTMLElement>(".param-row");
      if (!paramRow) {
        errors.push("selected radius has no graph param row for source hover");
      } else {
        paramRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
        await nextFrame();
        if (graphSourceHoverEvents.at(-1) !== "sphere:radius") {
          errors.push(`graph param hover emitted ${graphSourceHoverEvents.at(-1) || "nothing"}`);
        }
        if (codeRoot.querySelectorAll(".source-hovered-link").length === 0) {
          errors.push("graph param hover did not mark source as hovered");
        }
        paramRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
        await nextFrame();
        if (graphSourceHoverEvents.at(-1) !== "") {
          errors.push("graph param leave did not clear source hover event");
        }
        if (codeRoot.querySelectorAll(".source-hovered-link").length !== 0) {
          errors.push("graph param leave did not clear hovered source decoration");
        }
      }
      verifySourceScrubPath(radiusLink, sourceScrub, graphInspector, sdf, errors);
      if (sourceScrub.patchedSource) {
        const patchedLinks = findGraphSourceLinks(sourceScrub.patchedSource, sdf);
        const editedLink = patchedLinks.find((link) => {
          return link.nodeId === radiusLink.nodeId && link.label === "radius" && link.end > link.start;
        }) ?? null;
        codeEditor.setValue(sourceScrub.patchedSource);
        codeEditor.setSourceLinks(patchedLinks.filter((link) => link.nodeId !== sdf.node.id));
        graphInspector.setSourceLinks(patchedLinks);
        graphInspector.setSelectedSourceLink(editedLink);
        codeEditor.markSelectedSourceLink(editedLink);
        codeEditor.markEditedSourceLink(editedLink);
        await nextFrame();
        sourceScrub.editedSourceDecorations = codeRoot.querySelectorAll(".source-edited-link").length;
        sourceScrub.selectedGraphParamsAfterPatch = graphRoot.querySelectorAll(".param-row.source-selected").length;
        if (!editedLink) {
          errors.push("graph edit patch did not rediscover edited source link");
        }
        if (sourceScrub.editedSourceDecorations === 0) {
          errors.push("graph edit patch did not mark edited source literal");
        }
        if (sourceScrub.selectedGraphParamsAfterPatch !== 1) {
          errors.push("graph edit patch did not keep graph param linked to source");
        }
        codeEditor.setValue(fixtureSource);
        codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));
        graphInspector.setSourceLinks(links);
      }
    }

    const boxCallLink = links.find((link) => link.nodeKind === "box" && link.label === "call");
    if (!boxCallLink) {
      errors.push("fixture has no box call source link");
    } else {
      await revealAndSettle(codeEditor, boxCallLink);
      if (cursorEvents.at(-1) !== "box:call") {
        errors.push(`cursor over box call emitted ${cursorEvents.at(-1) || "nothing"}`);
      }
      if (!selectedNode.startsWith("box #")) {
        errors.push(`box cursor selected ${selectedNode || "nothing"}`);
      }
      if (graphRoot.querySelectorAll(".param-title.source-selected").length !== 1) {
        errors.push("box call cursor did not mark selected graph title");
      }
    }

    const selectedSourceDecorations = codeRoot.querySelectorAll(".source-selected-link").length;
    const selectedGraphParams = graphRoot.querySelectorAll(".param-row.source-selected, .axis-control.source-selected").length;
    const selectedGraphTitles = graphRoot.querySelectorAll(".param-title.source-selected").length;
    const graphSourceHoverDecorations = codeRoot.querySelectorAll(".source-hovered-link").length;
    if (selectedSourceDecorations === 0) {
      errors.push("selected source decoration did not render");
    }

    return {
      ok: errors.length === 0,
      links: links.length,
      cursorEvents,
      selectedNode,
      selectedSourceDecorations,
      selectedGraphParams,
      selectedGraphTitles,
      graphSelections,
      graphRevealEvents,
      graphSourceHoverEvents,
      graphSourceHoverDecorations,
      sourceScrub,
      selectionRestore,
      errors,
    };
  } finally {
    codeEditor?.dispose();
  }

  function selectFromSource(link: GraphSourceLink): void {
    const node = graphInspector.selectNodeById(link.nodeId);
    if (node) codeEditor?.markSelectedSourceLink(link);
  }
}

function verifySelectionRestore(errors: string[]): EditorRuntimeVerification["selectionRestore"] {
  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const boxCallLink = links.find((link) => link.nodeKind === "box" && link.label === "call");
  const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  const identity = boxCallLink ? graphNodeSourceIdentityForNode(links, boxCallLink.nodeId) : null;
  const sourceIdentity = radiusLink ? graphSourceLinkIdentityForLink(links, radiusLink) : null;
  const shiftedSource = `// shifted source offsets\n${fixtureSource}`;
  const { sdf: shiftedSdf } = evaluateSource(shiftedSource);
  const shiftedLinks = findGraphSourceLinks(shiftedSource, shiftedSdf);
  const restoredLink = identity ? sourceLinkForGraphNodeIdentity(shiftedLinks, identity) : null;
  const restoredRadiusLink = sourceIdentity ? sourceLinkForGraphSourceLinkIdentity(shiftedLinks, sourceIdentity) : null;
  const root = document.createElement("div");
  let selectedNode = "";
  const inspector = new GraphInspector(root, {
    onSelect(node) {
      selectedNode = node ? `${node.kind} #${node.id}` : "";
    },
    onHover() {},
    onEdit() {},
    onSolo() {},
    onRevealSource() {},
    onSourceHover() {},
    onVisibilityChange() {},
  });

  inspector.setSdf(shiftedSdf);
  inspector.setSourceLinks(shiftedLinks);
  if (restoredRadiusLink) {
    inspector.selectNodeById(restoredRadiusLink.nodeId);
    inspector.setSelectedSourceLink(restoredRadiusLink);
  } else if (restoredLink) {
    inspector.selectNodeById(restoredLink.nodeId);
  }
  const selectedParamRows = root.querySelectorAll(".param-row.source-selected").length;

  if (!boxCallLink) errors.push("selection restore fixture has no box call link");
  if (!radiusLink) errors.push("selection restore fixture has no sphere radius link");
  if (!identity) errors.push("selection restore could not capture box identity");
  if (!sourceIdentity) errors.push("selection restore could not capture radius source identity");
  if (!restoredLink) {
    errors.push("selection restore did not find shifted box link");
  } else {
    if (restoredLink.nodeKind !== "box") errors.push(`selection restore found ${restoredLink.nodeKind}`);
    if (boxCallLink && restoredLink.start === boxCallLink.start) {
      errors.push("selection restore fixture did not shift source offsets");
    }
  }
  if (!restoredRadiusLink) {
    errors.push("selection restore did not find shifted radius link");
  } else {
    if (restoredRadiusLink.nodeKind !== "sphere" || restoredRadiusLink.label !== "radius") {
      errors.push(`selection restore found ${restoredRadiusLink.nodeKind}:${restoredRadiusLink.label}`);
    }
    if (radiusLink && restoredRadiusLink.start === radiusLink.start) {
      errors.push("selection restore radius fixture did not shift source offsets");
    }
  }
  if (selectedParamRows !== 1) errors.push(`selection restore marked ${selectedParamRows} selected param rows`);
  if (!selectedNode.startsWith("sphere #")) errors.push(`selection restore selected ${selectedNode || "nothing"}`);

  return {
    previousNode: boxCallLink ? `${boxCallLink.nodeKind}:${boxCallLink.label}` : "",
    restoredNode: restoredLink ? `${restoredLink.nodeKind}:${restoredLink.label}` : "",
    previousStart: boxCallLink?.start ?? -1,
    restoredStart: restoredLink?.start ?? -1,
    previousParam: radiusLink ? `${radiusLink.nodeKind}:${radiusLink.label}` : "",
    restoredParam: restoredRadiusLink ? `${restoredRadiusLink.nodeKind}:${restoredRadiusLink.label}` : "",
    previousParamStart: radiusLink?.start ?? -1,
    restoredParamStart: restoredRadiusLink?.start ?? -1,
    selectedParamRows,
    selectedNode,
  };
}

function verifySourceScrubPath(
  link: GraphSourceLink,
  state: EditorRuntimeVerification["sourceScrub"],
  graphInspector: GraphInspector,
  sdf: SDF3,
  errors: string[],
): void {
  const startValue = readSourceLinkNumber(fixtureSource, link);
  state.startValue = startValue;
  if (startValue == null) {
    errors.push("source scrub could not read linked number");
    return;
  }

  const nextValue = scrubSourceLinkValue(link, startValue, 8, { altKey: false, shiftKey: false });
  state.nextValue = nextValue;
  if (Math.abs(nextValue - 1.2) > 0.000001) {
    errors.push(`source scrub produced ${nextValue}`);
  }

  const previousValue = graphInspector.getParamValue(link.nodeId, link.path);
  if (typeof previousValue !== "number") {
    errors.push(`source scrub graph value was ${String(previousValue)}`);
    return;
  }

  const node = graphInspector.setParamValue(link.nodeId, link.path, nextValue);
  state.graphValue = graphInspector.getParamValue(link.nodeId, link.path);
  if (!node) {
    errors.push("source scrub could not mutate graph node");
    return;
  }
  if (state.graphValue !== nextValue) {
    errors.push(`source scrub graph value became ${String(state.graphValue)}`);
  }

  const patchedSource = patchGraphEditSource(fixtureSource, sdf, {
    nodeId: link.nodeId,
    nodeKind: link.nodeKind,
    path: link.path,
    label: link.label,
  }, nextValue);
  state.patchedSource = patchedSource ?? "";
  if (!patchedSource?.includes("sphere(1.2)")) {
    errors.push("source scrub did not patch source literal");
  }
}

async function revealAndSettle(
  codeEditor: ReturnType<typeof createCodeEditor>,
  link: GraphSourceLink,
): Promise<void> {
  codeEditor.revealSourceLink(link);
  await nextFrame();
  await nextFrame();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
