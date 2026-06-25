import { findGraphSourceLinks, type GraphSourceLink } from "../editor/clean-source-patch";
import { type createCodeEditor, sourceLinkHoverMessage } from "../editor/code-editor";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";
import {
  graphNodeSourceIdentityForNode,
  graphSourceLinkIdentityForLink,
  sourceLinkForGraphNodeIdentity,
  sourceLinkForGraphSourceLinkIdentity,
} from "../editor/graph-source-identity";
import { sourceInlayHintKeyForLink, sourceInlayHintsForOffsetRange } from "../editor/source-inlay-hints";
import { sourceLinkAtOffset, stickySourceLinkAtOffset } from "../editor/source-link-hit-test";

export const EDITOR_FIXTURE_SOURCE = `
const left = sphere(1).translate([-0.45, 0, 0])
const right = box(0.8).translate([0.45, 0, 0])
return left.union(right, { k: 0.12 })
`;

export interface EditorSourceLinkHitTestVerification {
  exactGap: string;
  stickyGap: string;
  preferredGap: string;
  farGap: string;
}

export interface EditorSourceInlayHintsVerification {
  count: number;
  sphereCall: string;
  sphereCallKey: string;
  sphereRadius: string;
  sphereRadiusKey: string;
  translateOffset: string;
}

export interface EditorSourceLinkTooltipsVerification {
  call: string;
  number: string;
}

export interface EditorSourceNavigationVerification {
  nextLink: string;
  previousLink: string;
  revealGraphLink: string;
  selectionEvents: number;
  revealGraphEvents: number;
}

export interface EditorSelectionRestoreVerification {
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
}

export async function verifySourceNavigation(
  codeEditor: ReturnType<typeof createCodeEditor>,
  links: readonly GraphSourceLink[],
  sourceSelectionEvents: string[],
  sourceRevealGraphEvents: string[],
  errors: string[],
): Promise<EditorSourceNavigationVerification> {
  const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  if (!radiusLink) {
    errors.push("source navigation fixture has no sphere radius link");
    return { nextLink: "", previousLink: "", revealGraphLink: "", selectionEvents: 0, revealGraphEvents: 0 };
  }

  codeEditor.revealSourceLink(radiusLink);
  await nextFrame();
  const beforeEvents = sourceSelectionEvents.length;
  const beforeRevealGraphEvents = sourceRevealGraphEvents.length;
  if (!codeEditor.selectAdjacentSourceLink(1)) {
    errors.push("source navigation did not select next link");
  }
  await nextFrame();
  const nextLink = sourceSelectionEvents.at(-1) ?? "";
  if (!nextLink || nextLink === "sphere:radius") {
    errors.push(`source navigation next selected ${nextLink || "nothing"}`);
  }

  if (!codeEditor.selectAdjacentSourceLink(-1)) {
    errors.push("source navigation did not select previous link");
  }
  await nextFrame();
  const previousLink = sourceSelectionEvents.at(-1) ?? "";
  if (previousLink !== "sphere:radius") {
    errors.push(`source navigation previous selected ${previousLink || "nothing"}`);
  }

  if (!codeEditor.revealCurrentSourceLinkInGraph()) {
    errors.push("source navigation did not reveal current link in graph");
  }
  await nextFrame();
  const revealGraphLink = sourceRevealGraphEvents.at(-1) ?? "";
  if (revealGraphLink !== previousLink) {
    errors.push(`source navigation graph reveal selected ${revealGraphLink || "nothing"}`);
  }

  return {
    nextLink,
    previousLink,
    revealGraphLink,
    selectionEvents: sourceSelectionEvents.length - beforeEvents,
    revealGraphEvents: sourceRevealGraphEvents.length - beforeRevealGraphEvents,
  };
}

export function verifySourceInlayHints(
  source: string,
  links: readonly GraphSourceLink[],
  errors: string[],
): EditorSourceInlayHintsVerification {
  const hints = sourceInlayHintsForOffsetRange(links, 0, source.length);
  const sphereCall = hints.find((hint) => hint.tooltip.startsWith("sphere #") && hint.label.startsWith("#"));
  const sphereRadius = hints.find((hint) => hint.tooltip.includes("sphere #") && hint.label === "radius");
  const translateOffset = hints.find((hint) => hint.tooltip.includes("translate #") && hint.label === "offset.x");
  const sphereCallLink = links.find((link) => link.nodeKind === "sphere" && link.label === "call");
  const sphereRadiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");

  if (!sphereCall) errors.push("source inlay hints missing sphere node id");
  if (!sphereRadius) errors.push("source inlay hints missing sphere radius label");
  if (!translateOffset) errors.push("source inlay hints missing translate offset axis label");
  if (sphereCall && sphereCallLink && sphereCall.key !== sourceInlayHintKeyForLink(sphereCallLink)) {
    errors.push("source inlay hint sphere call key does not match link");
  }
  if (sphereRadius && sphereRadiusLink && sphereRadius.key !== sourceInlayHintKeyForLink(sphereRadiusLink)) {
    errors.push("source inlay hint sphere radius key does not match link");
  }

  return {
    count: hints.length,
    sphereCall: sphereCall?.label ?? "",
    sphereCallKey: sphereCall?.key ?? "",
    sphereRadius: sphereRadius?.label ?? "",
    sphereRadiusKey: sphereRadius?.key ?? "",
    translateOffset: translateOffset?.label ?? "",
  };
}

export function verifySourceLinkTooltips(
  links: readonly GraphSourceLink[],
  errors: string[],
): EditorSourceLinkTooltipsVerification {
  const callLink = links.find((link) => link.nodeKind === "sphere" && link.label === "call");
  const numberLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  const call = callLink ? sourceLinkHoverMessage(callLink, false) : "";
  const number = numberLink ? sourceLinkHoverMessage(numberLink, true) : "";

  if (!call.includes("Use chip arrows")) errors.push(`source call tooltip missed navigation hint: ${call || "nothing"}`);
  if (!call.includes("Cmd/Ctrl-click opens this node in Graph")) {
    errors.push(`source call tooltip missed graph reveal hint: ${call || "nothing"}`);
  }
  if (!number.includes("Drag sideways")) errors.push(`source number tooltip missed drag hint: ${number || "nothing"}`);
  if (!number.includes("Use chip arrows")) errors.push(`source number tooltip missed navigation hint: ${number || "nothing"}`);
  if (!number.includes("Cmd/Ctrl-click opens this node in Graph")) {
    errors.push(`source number tooltip missed graph reveal hint: ${number || "nothing"}`);
  }

  return { call, number };
}

export function verifySourceLinkHitTest(errors: string[]): EditorSourceLinkHitTestVerification {
  const { sdf } = evaluateSource(EDITOR_FIXTURE_SOURCE);
  const links = findGraphSourceLinks(EDITOR_FIXTURE_SOURCE, sdf);
  const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  const translateLink = links.find((link) => link.nodeKind === "translate3" && link.label === "offset[0]");
  const lineForOffset = (offset: number) => EDITOR_FIXTURE_SOURCE.slice(0, Math.max(0, offset)).split("\n").length;
  const gapOffset = (radiusLink?.end ?? 0) + 1;
  const farOffset = EDITOR_FIXTURE_SOURCE.indexOf("return left");
  const exactGapLink = radiusLink ? sourceLinkAtOffset(links, gapOffset) : null;
  const stickyGapLink = radiusLink ? stickySourceLinkAtOffset(links, gapOffset, lineForOffset) : null;
  const preferredGapLink = radiusLink
    ? stickySourceLinkAtOffset(links, gapOffset, lineForOffset, { preferredNodeId: translateLink?.nodeId ?? -1 })
    : null;
  const farGapLink = farOffset >= 0 ? stickySourceLinkAtOffset(links, farOffset, lineForOffset) : null;

  if (!radiusLink) errors.push("source hit-test fixture has no radius link");
  if (exactGapLink) errors.push(`source hit-test exact gap unexpectedly found ${formatLink(exactGapLink)}`);
  if (radiusLink && stickyGapLink?.nodeId !== radiusLink.nodeId) {
    errors.push(`source hit-test sticky gap found ${formatLink(stickyGapLink) || "nothing"}`);
  }
  if (radiusLink && preferredGapLink?.nodeId !== radiusLink.nodeId) {
    errors.push(`source hit-test preferred gap jumped to ${formatLink(preferredGapLink) || "nothing"}`);
  }
  if (farGapLink) errors.push(`source hit-test far gap unexpectedly found ${formatLink(farGapLink)}`);

  return {
    exactGap: formatLink(exactGapLink),
    stickyGap: formatLink(stickyGapLink),
    preferredGap: formatLink(preferredGapLink),
    farGap: formatLink(farGapLink),
  };
}

export function verifySelectionRestore(errors: string[]): EditorSelectionRestoreVerification {
  const { sdf } = evaluateSource(EDITOR_FIXTURE_SOURCE);
  const links = findGraphSourceLinks(EDITOR_FIXTURE_SOURCE, sdf);
  const boxCallLink = links.find((link) => link.nodeKind === "box" && link.label === "call");
  const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  const identity = boxCallLink ? graphNodeSourceIdentityForNode(links, boxCallLink.nodeId) : null;
  const sourceIdentity = radiusLink ? graphSourceLinkIdentityForLink(links, radiusLink) : null;
  const shiftedSource = `// shifted source offsets\n${EDITOR_FIXTURE_SOURCE}`;
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

export function formatLink(link: GraphSourceLink | null): string {
  return link ? `${link.nodeKind}:${link.label}` : "";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(done, 50);
    function done(): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    }
    window.requestAnimationFrame(done);
  });
}
