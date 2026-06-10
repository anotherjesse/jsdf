import { findGraphSourceLinks, type GraphSourceLink } from "../editor/clean-source-patch";
import { createCodeEditor } from "../editor/code-editor";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";

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
  errors: string[];
}

export async function runEditorRuntimeVerification(
  codeRoot: HTMLElement,
  graphRoot: HTMLElement,
): Promise<EditorRuntimeVerification> {
  const errors: string[] = [];
  const cursorEvents: string[] = [];
  const graphSelections: string[] = [];
  let selectedNode = "";

  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const graphInspector = new GraphInspector(graphRoot, {
    onSelect(node) {
      selectedNode = node ? `${node.kind} #${node.id}` : "";
      graphSelections.push(selectedNode);
    },
    onHover() {},
    onEdit() {},
    onSolo() {},
    onRevealSource() {},
    onSourceHover() {},
    onVisibilityChange() {},
  });
  const codeEditor = createCodeEditor(
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
      errors,
    };
  } finally {
    codeEditor.dispose();
  }

  function selectFromSource(link: GraphSourceLink): void {
    const node = graphInspector.selectNodeById(link.nodeId);
    if (node) codeEditor.markSelectedSourceLink(link);
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
