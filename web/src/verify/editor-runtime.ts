import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { createCodeEditor } from "../editor/code-editor";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";
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
  sourceScrub: {
    startValue: number | null;
    nextValue: number | null;
    graphValue: unknown;
    patchedSource: string;
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
  const sourceScrub: EditorRuntimeVerification["sourceScrub"] = {
    startValue: null,
    nextValue: null,
    graphValue: null,
    patchedSource: "",
  };
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
    onSourceHover() {},
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
      verifySourceScrubPath(radiusLink, sourceScrub, graphInspector, sdf, errors);
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
      sourceScrub,
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
