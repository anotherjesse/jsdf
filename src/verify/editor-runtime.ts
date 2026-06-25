import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { createCodeEditor, sourceLinkHoverMessage, sourceLinkStatusText } from "../editor/code-editor";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";
import { sourceInlayHintKeyForLink, sourceInlayHintsForOffsetRange } from "../editor/source-inlay-hints";
import {
  graphNodeSourceIdentityForNode,
  graphSourceLinkIdentityForLink,
  sourceLinkForGraphNodeIdentity,
  sourceLinkForGraphSourceLinkIdentity,
} from "../editor/graph-source-identity";
import { sourceLinkAtOffset, stickySourceLinkAtOffset } from "../editor/source-link-hit-test";
import { readSourceLinkNumber, scrubSourceLinkValue } from "../editor/source-link-scrub";
import type { SDF3 } from "../core/nodes";
import {
  type EditorApiHintsVerification,
  type EditorPreferencesVerification,
  type EditorToolsVerification,
  verifyCodeEditorQuickFix,
  verifyEditorApiHints,
  verifyEditorPreferences,
  verifyEditorTools,
} from "./editor-tooling-runtime";

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
  sourceSelectionEvents: string[];
  graphSourceHoverDecorations: number;
  recursiveDecorationWarnings: number;
  sourceScrub: {
    startValue: number | null;
    nextValue: number | null;
    keyboardNextValue: number | null;
    keyboardEditSession: string;
    keyboardReadout: string;
    graphValue: unknown;
    patchedSource: string;
    editedSourceDecorations: number;
    selectedGraphParamsAfterPatch: number;
  };
  sourceLinkHitTest: {
    exactGap: string;
    stickyGap: string;
    preferredGap: string;
    farGap: string;
  };
  sourceInlayHints: {
    count: number;
    sphereCall: string;
    sphereCallKey: string;
    sphereRadius: string;
    sphereRadiusKey: string;
    translateOffset: string;
  };
  sourceLinkTooltips: {
    call: string;
    number: string;
  };
  sourceLinkStatus: {
    radius: string;
    graphReveal: string;
    radiusRevealTargetLabel: string;
    radiusRevealTargetLink: string;
    radiusNavigationButtons: number;
    radiusNavigationIndex: string;
    radiusNavigationNextIndex: string;
    radiusNavigationPreviousIndex: string;
    radiusNavigationNextLink: string;
    radiusNavigationPreviousLink: string;
    radiusNavigationPreviousStatus: string;
    radiusStepButtons: number;
    radiusStepTitle: string;
    radiusStepNextValue: number | null;
    radiusStepStatus: string;
    radiusFineStepNextValue: number | null;
    radiusFineStepStatus: string;
    radiusStepSession: string;
    hiddenAfterClear: boolean;
    box: string;
    boxStepButtons: number;
  };
  sourceNavigation: {
    nextLink: string;
    previousLink: string;
    revealGraphLink: string;
    selectionEvents: number;
    revealGraphEvents: number;
  };
  editorPreferences: EditorPreferencesVerification;
  apiHints: EditorApiHintsVerification;
  editorTools: EditorToolsVerification;
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
  onProgress: (step: string) => void = () => {},
): Promise<EditorRuntimeVerification> {
  onProgress("setup");
  const errors: string[] = [];
  const cursorEvents: string[] = [];
  const graphSelections: string[] = [];
  const graphRevealEvents: string[] = [];
  const graphSourceHoverEvents: string[] = [];
  const sourceSelectionEvents: string[] = [];
  const sourceRevealGraphEvents: string[] = [];
  const sourceChangeEvents: string[] = [];
  const recursiveDecorationMessages: string[] = [];
  const restoreConsole = captureRecursiveDecorationMessages(recursiveDecorationMessages);
  const sourceScrub: EditorRuntimeVerification["sourceScrub"] = {
    startValue: null,
    nextValue: null,
    keyboardNextValue: null,
    keyboardEditSession: "",
    keyboardReadout: "",
    graphValue: null,
    patchedSource: "",
    editedSourceDecorations: 0,
    selectedGraphParamsAfterPatch: 0,
  };
  const sourceLinkHitTest = verifySourceLinkHitTest(errors);
  const editorPreferences = verifyEditorPreferences(errors);
  const apiHints = verifyEditorApiHints(errors);
  const editorTools = verifyEditorTools(errors);
  const selectionRestore = verifySelectionRestore(errors);
  let selectedNode = "";

  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const sourceInlayHints = verifySourceInlayHints(fixtureSource, links, errors);
  const sourceLinkTooltips = verifySourceLinkTooltips(links, errors);
  const sourceLinkStatus: EditorRuntimeVerification["sourceLinkStatus"] = {
    radius: "",
    graphReveal: "",
    radiusRevealTargetLabel: "",
    radiusRevealTargetLink: "",
    radiusNavigationButtons: 0,
    radiusNavigationIndex: "",
    radiusNavigationNextIndex: "",
    radiusNavigationPreviousIndex: "",
    radiusNavigationNextLink: "",
    radiusNavigationPreviousLink: "",
    radiusNavigationPreviousStatus: "",
    radiusStepButtons: 0,
    radiusStepTitle: "",
    radiusStepNextValue: null,
    radiusStepStatus: "",
    radiusFineStepNextValue: null,
    radiusFineStepStatus: "",
    radiusStepSession: "",
    hiddenAfterClear: false,
    box: "",
    boxStepButtons: -1,
  };
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
    (value) => sourceChangeEvents.push(value),
    (link, options) => {
      sourceSelectionEvents.push(formatLink(link));
      if (options?.revealGraph) {
        sourceRevealGraphEvents.push(formatLink(link));
      }
      selectFromSource(link);
    },
    (link, value, options) => {
      if (link.nodeKind !== "sphere" || link.label !== "radius") return;
      if (options?.editSessionId?.startsWith("source-status-step:")) {
        if (sourceLinkStatus.radiusStepNextValue == null) {
          sourceLinkStatus.radiusStepNextValue = value;
        } else {
          sourceLinkStatus.radiusFineStepNextValue = value;
        }
        sourceLinkStatus.radiusStepSession = options.editSessionId;
        return;
      }
      sourceScrub.keyboardNextValue = value;
      sourceScrub.keyboardEditSession = options?.editSessionId ?? "";
    },
    () => {},
    (link) => {
      if (!link) return;
      cursorEvents.push(`${link.nodeKind}:${link.label}`);
      selectFromSource(link);
    },
  );

  try {
    onProgress("graph setup");
    graphInspector.setSdf(sdf);
    graphInspector.setSourceLinks(links);
    codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));

    const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
    if (!radiusLink) {
      errors.push("fixture has no sphere radius source link");
    } else {
      onProgress("source link status: reveal");
      await revealAndSettle(codeEditor, radiusLink);
      sourceLinkStatus.radius = visibleSourceLinkStatus(codeRoot);
      if (sourceLinkStatus.radius !== sourceLinkStatusText(radiusLink, readSourceLinkNumber(fixtureSource, radiusLink))) {
        errors.push(`source link status rendered ${sourceLinkStatus.radius || "nothing"} for radius`);
      }
      sourceLinkStatus.radiusNavigationButtons = visibleSourceLinkNavigationCount(codeRoot);
      if (sourceLinkStatus.radiusNavigationButtons !== 2) {
        errors.push(`source link status rendered ${sourceLinkStatus.radiusNavigationButtons} navigation buttons`);
      }
      sourceLinkStatus.radiusNavigationIndex = visibleSourceLinkNavigationIndex(codeRoot);
      if (!/^\d+\/\d+$/.test(sourceLinkStatus.radiusNavigationIndex)) {
        errors.push(`source link status rendered ${sourceLinkStatus.radiusNavigationIndex || "nothing"} navigation index`);
      }
      onProgress("source link status: navigation");
      const nextButton = codeRoot.querySelector<HTMLButtonElement>(".source-link-status-navigation .source-link-status-nav[data-direction='next']");
      const previousButton = codeRoot.querySelector<HTMLButtonElement>(".source-link-status-navigation .source-link-status-nav[data-direction='previous']");
      if (!nextButton || !previousButton) {
        errors.push("source link status did not render next and previous navigation buttons");
      } else {
        const beforeNavigationEvents = sourceSelectionEvents.length;
        nextButton.click();
        await nextFrame();
        sourceLinkStatus.radiusNavigationNextLink = sourceSelectionEvents.at(-1) ?? "";
        sourceLinkStatus.radiusNavigationNextIndex = visibleSourceLinkNavigationIndex(codeRoot);
        if (sourceSelectionEvents.length <= beforeNavigationEvents || !sourceLinkStatus.radiusNavigationNextLink || sourceLinkStatus.radiusNavigationNextLink === "sphere:radius") {
          errors.push(`source link status next selected ${sourceLinkStatus.radiusNavigationNextLink || "nothing"}`);
        }
        if (sourceLinkStatus.radiusNavigationNextIndex === sourceLinkStatus.radiusNavigationIndex) {
          errors.push(`source link status next kept index ${sourceLinkStatus.radiusNavigationNextIndex || "nothing"}`);
        }
        previousButton.click();
        await nextFrame();
        sourceLinkStatus.radiusNavigationPreviousLink = sourceSelectionEvents.at(-1) ?? "";
        sourceLinkStatus.radiusNavigationPreviousIndex = visibleSourceLinkNavigationIndex(codeRoot);
        sourceLinkStatus.radiusNavigationPreviousStatus = visibleSourceLinkStatus(codeRoot);
        if (sourceLinkStatus.radiusNavigationPreviousLink !== "sphere:radius") {
          errors.push(`source link status previous selected ${sourceLinkStatus.radiusNavigationPreviousLink || "nothing"}`);
        }
        if (sourceLinkStatus.radiusNavigationPreviousStatus !== sourceLinkStatus.radius) {
          errors.push(`source link status previous displayed ${sourceLinkStatus.radiusNavigationPreviousStatus || "nothing"}`);
        }
        if (sourceLinkStatus.radiusNavigationPreviousIndex !== sourceLinkStatus.radiusNavigationIndex) {
          errors.push(`source link status previous restored index ${sourceLinkStatus.radiusNavigationPreviousIndex || "nothing"}`);
        }
      }
      onProgress("source link status: reveal graph");
      const statusTarget = codeRoot.querySelector<HTMLButtonElement>(".source-link-status-target");
      if (!statusTarget) {
        errors.push("source link status did not render a reveal target button");
      } else {
        sourceLinkStatus.radiusRevealTargetLabel = statusTarget.getAttribute("aria-label") ?? "";
        if (!sourceLinkStatus.radiusRevealTargetLabel.includes("sphere #") || !sourceLinkStatus.radiusRevealTargetLabel.includes("Graph")) {
          errors.push(`source link status reveal target label rendered ${sourceLinkStatus.radiusRevealTargetLabel || "nothing"}`);
        }
        const beforeRevealEvents = sourceRevealGraphEvents.length;
        statusTarget.click();
        await nextFrame();
        sourceLinkStatus.radiusRevealTargetLink = sourceRevealGraphEvents.at(-1) ?? "";
        if (sourceRevealGraphEvents.length <= beforeRevealEvents || sourceLinkStatus.radiusRevealTargetLink !== "sphere:radius") {
          errors.push(`source link status reveal target emitted ${sourceLinkStatus.radiusRevealTargetLink || "nothing"}`);
        }
      }
      onProgress("source link status: numeric step");
      sourceLinkStatus.radiusStepButtons = visibleSourceLinkStepperCount(codeRoot);
      if (sourceLinkStatus.radiusStepButtons !== 2) {
        errors.push(`source link status rendered ${sourceLinkStatus.radiusStepButtons} numeric step buttons`);
      }
      const increaseButton = codeRoot.querySelector<HTMLButtonElement>(".source-link-status-controls:not([hidden]) .source-link-status-step[data-direction='increase']");
      if (!increaseButton) {
        errors.push("source link status did not render an increase step button");
      } else {
        sourceLinkStatus.radiusStepTitle = increaseButton.title;
        if (!sourceLinkStatus.radiusStepTitle.includes("Shift/Alt-click")) {
          errors.push(`source link status step title rendered ${sourceLinkStatus.radiusStepTitle || "nothing"}`);
        }
        increaseButton.click();
        await nextFrame();
        sourceLinkStatus.radiusStepStatus = visibleSourceLinkStatus(codeRoot);
        if (Math.abs((sourceLinkStatus.radiusStepNextValue ?? 0) - 1.1) > 0.000001) {
          errors.push(`source link status step emitted ${sourceLinkStatus.radiusStepNextValue ?? "nothing"}`);
        }
        if (!sourceLinkStatus.radiusStepStatus.endsWith("= 1.1")) {
          errors.push(`source link status step displayed ${sourceLinkStatus.radiusStepStatus || "nothing"}`);
        }
        if (!sourceLinkStatus.radiusStepSession.startsWith("source-status-step:")) {
          errors.push(`source link status step session was ${sourceLinkStatus.radiusStepSession || "missing"}`);
        }
        increaseButton.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
        await nextFrame();
        sourceLinkStatus.radiusFineStepStatus = visibleSourceLinkStatus(codeRoot);
        if (Math.abs((sourceLinkStatus.radiusFineStepNextValue ?? 0) - 1.025) > 0.000001) {
          errors.push(`source link status fine step emitted ${sourceLinkStatus.radiusFineStepNextValue ?? "nothing"}`);
        }
        if (!sourceLinkStatus.radiusFineStepStatus.endsWith("= 1.025")) {
          errors.push(`source link status fine step displayed ${sourceLinkStatus.radiusFineStepStatus || "nothing"}`);
        }
      }
      onProgress("source link status: keyboard nudge");
      if (cursorEvents.at(-1) !== "sphere:radius") {
        errors.push(`cursor over radius emitted ${cursorEvents.at(-1) || "nothing"}`);
      }
      if (!codeEditor.nudgeCurrentSourceLink(1)) {
        errors.push("keyboard source nudge did not find current radius link");
      }
      await nextFrame();
      sourceScrub.keyboardReadout = codeRoot.querySelector<HTMLElement>(".source-scrub-readout[data-visible='true']")?.textContent?.trim() ?? "";
      if (Math.abs((sourceScrub.keyboardNextValue ?? 0) - 1.1) > 0.000001) {
        errors.push(`keyboard source nudge emitted ${sourceScrub.keyboardNextValue ?? "nothing"}`);
      }
      if (!sourceScrub.keyboardReadout.includes("radius 1.1")) {
        errors.push(`keyboard source nudge readout was ${sourceScrub.keyboardReadout || "missing"}`);
      }
      if (!sourceScrub.keyboardEditSession.startsWith("source-key-nudge:")) {
        errors.push(`keyboard source nudge session was ${sourceScrub.keyboardEditSession || "missing"}`);
      }
      if (!selectedNode.startsWith("sphere #")) {
        errors.push(`radius cursor selected ${selectedNode || "nothing"}`);
      }
      if (graphRoot.querySelectorAll(".param-row.source-selected").length !== 1) {
        errors.push("radius cursor did not mark exactly one graph param row selected");
      }
      onProgress("source link status: graph reveal");
      const paramCodeButton = graphRoot.querySelector<HTMLButtonElement>(".param-row .param-source-link");
      if (!paramCodeButton) {
        errors.push("selected radius has no graph source reveal button");
      } else {
        if (!paramCodeButton.getAttribute("aria-label")?.startsWith("Reveal sphere #")) {
          errors.push(`graph param reveal label rendered ${paramCodeButton.getAttribute("aria-label") || "nothing"}`);
        }
        paramCodeButton.click();
        await nextFrame();
        sourceLinkStatus.graphReveal = visibleSourceLinkStatus(codeRoot);
        if (sourceLinkStatus.graphReveal !== sourceLinkStatusText(radiusLink, readSourceLinkNumber(fixtureSource, radiusLink))) {
          errors.push(`source link status after graph reveal rendered ${sourceLinkStatus.graphReveal || "nothing"}`);
        }
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
      onProgress("source link status: graph hover");
      const paramRow = graphRoot.querySelector<HTMLElement>(".param-row");
      if (!paramRow) {
        errors.push("selected radius has no graph param row for source hover");
      } else {
        paramRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
        await nextFrame();
        if (graphSourceHoverEvents.at(-1) !== "sphere:radius") {
          errors.push(`graph param hover emitted ${graphSourceHoverEvents.at(-1) || "nothing"}`);
        }
        await nextFrame();
        if (codeEditor.sourceDecorationCount("hovered") === 0) {
          errors.push("graph param hover did not mark source as hovered");
        }
        paramRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
        await nextFrame();
        if (graphSourceHoverEvents.at(-1) !== "") {
          errors.push("graph param leave did not clear source hover event");
        }
        if (codeEditor.sourceDecorationCount("hovered") !== 0) {
          errors.push("graph param leave did not clear hovered source decoration");
        }
      }
      onProgress("source link status: scrub path");
      verifySourceScrubPath(radiusLink, sourceScrub, graphInspector, sdf, errors);
      if (sourceScrub.patchedSource) {
        onProgress("source patch restore");
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
        sourceScrub.editedSourceDecorations = codeEditor.sourceDecorationCount("edited");
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

    onProgress("quick fixes");
    verifyCodeEditorQuickFix(codeEditor, editorTools, sourceChangeEvents, errors);
    codeEditor.setValue(fixtureSource);
    codeEditor.setError(null);
    codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));
    graphInspector.setSourceLinks(links);
    onProgress("source navigation");
    const sourceNavigation = await verifySourceNavigation(
      codeEditor,
      links,
      sourceSelectionEvents,
      sourceRevealGraphEvents,
      errors,
    );

    const boxCallLink = links.find((link) => link.nodeKind === "box" && link.label === "call");
    if (!boxCallLink) {
      errors.push("fixture has no box call source link");
    } else {
      onProgress("box link status");
      await revealAndSettle(codeEditor, boxCallLink);
      sourceLinkStatus.box = visibleSourceLinkStatus(codeRoot);
      if (sourceLinkStatus.box !== sourceLinkStatusText(boxCallLink, readSourceLinkNumber(fixtureSource, boxCallLink))) {
        errors.push(`source link status rendered ${sourceLinkStatus.box || "nothing"} for box`);
      }
      sourceLinkStatus.boxStepButtons = visibleSourceLinkStepperCount(codeRoot);
      if (sourceLinkStatus.boxStepButtons !== 0) {
        errors.push(`box call source link rendered ${sourceLinkStatus.boxStepButtons} numeric step buttons`);
      }
      codeEditor.markSelectedSourceLink(null);
      await nextFrame();
      sourceLinkStatus.hiddenAfterClear = !codeRoot.querySelector(".source-link-status:not([hidden])");
      if (!sourceLinkStatus.hiddenAfterClear) {
        errors.push(`source link status stayed visible after clear as ${visibleSourceLinkStatus(codeRoot) || "nothing"}`);
      }
      codeEditor.markSelectedSourceLink(boxCallLink, { reveal: true });
      await nextFrame();
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

    const selectedSourceDecorations = codeEditor.sourceDecorationCount("selected");
    const selectedGraphParams = graphRoot.querySelectorAll(".param-row.source-selected, .axis-control.source-selected").length;
    const selectedGraphTitles = graphRoot.querySelectorAll(".param-title.source-selected").length;
    const graphSourceHoverDecorations = codeRoot.querySelectorAll(".source-hovered-link").length;
    if (selectedSourceDecorations === 0) {
      errors.push("selected source decoration did not remain registered");
    }
    if (recursiveDecorationMessages.length > 0) {
      errors.push("editor selection triggered recursive Monaco decoration warnings");
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
      sourceSelectionEvents,
      graphSourceHoverDecorations,
      recursiveDecorationWarnings: recursiveDecorationMessages.length,
      sourceScrub,
      sourceLinkHitTest,
      sourceInlayHints,
      sourceLinkTooltips,
      sourceLinkStatus,
      sourceNavigation,
      editorPreferences,
      apiHints,
      editorTools,
      selectionRestore,
      errors,
    };
  } finally {
    restoreConsole();
    codeEditor?.dispose();
  }

  function selectFromSource(link: GraphSourceLink): void {
    const node = graphInspector.selectNodeById(link.nodeId);
    if (!node) return;
    graphInspector.setSelectedSourceLink(link);
    codeEditor?.markSelectedSourceLink(link);
  }
}

function captureRecursiveDecorationMessages(messages: string[]): () => void {
  const originalWarn = console.warn;
  const originalError = console.error;
  const capture = (args: readonly unknown[]) => {
    const message = args.map((arg) => String(arg)).join(" ");
    if (message.includes("Invoking deltaDecorations recursively")) {
      messages.push(message);
    }
  };
  console.warn = (...args: unknown[]) => {
    capture(args);
    originalWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    capture(args);
    originalError.apply(console, args);
  };
  return () => {
    console.warn = originalWarn;
    console.error = originalError;
  };
}

async function verifySourceNavigation(
  codeEditor: ReturnType<typeof createCodeEditor>,
  links: readonly GraphSourceLink[],
  sourceSelectionEvents: string[],
  sourceRevealGraphEvents: string[],
  errors: string[],
): Promise<EditorRuntimeVerification["sourceNavigation"]> {
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

function verifySourceInlayHints(
  source: string,
  links: readonly GraphSourceLink[],
  errors: string[],
): EditorRuntimeVerification["sourceInlayHints"] {
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

function verifySourceLinkTooltips(
  links: readonly GraphSourceLink[],
  errors: string[],
): EditorRuntimeVerification["sourceLinkTooltips"] {
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

function verifySourceLinkHitTest(errors: string[]): EditorRuntimeVerification["sourceLinkHitTest"] {
  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const radiusLink = links.find((link) => link.nodeKind === "sphere" && link.label === "radius");
  const translateLink = links.find((link) => link.nodeKind === "translate3" && link.label === "offset[0]");
  const lineForOffset = (offset: number) => fixtureSource.slice(0, Math.max(0, offset)).split("\n").length;
  const gapOffset = (radiusLink?.end ?? 0) + 1;
  const farOffset = fixtureSource.indexOf("return left");
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

function formatLink(link: GraphSourceLink | null): string {
  return link ? `${link.nodeKind}:${link.label}` : "";
}

function visibleSourceLinkStatus(root: HTMLElement): string {
  return root.querySelector<HTMLElement>(".source-link-status:not([hidden]) .source-link-status-text")?.textContent?.trim() ?? "";
}

function visibleSourceLinkStepperCount(root: HTMLElement): number {
  return root.querySelectorAll(".source-link-status-controls:not([hidden]) .source-link-status-step").length;
}

function visibleSourceLinkNavigationCount(root: HTMLElement): number {
  return root.querySelectorAll(".source-link-status:not([hidden]) .source-link-status-navigation .source-link-status-nav").length;
}

function visibleSourceLinkNavigationIndex(root: HTMLElement): string {
  return root.querySelector<HTMLElement>(".source-link-status:not([hidden]) .source-link-status-navigation .source-link-status-index")
    ?.textContent?.trim() ?? "";
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
