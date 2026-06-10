import { apiCompletionEntriesForScope, apiReferenceForWord } from "../editor/api-reference";
import { apiSignatureHelpAt } from "../editor/api-signature-help";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceLink } from "../editor/clean-source-patch";
import { createCodeEditor } from "../editor/code-editor";
import { loadEditorPreferences, saveEditorPreferences } from "../editor/editor-preferences";
import { evaluateSource } from "../editor/evaluate-source";
import { GraphInspector } from "../editor/graph-inspector";
import { prettifySource } from "../editor/prettify-source";
import {
  SOURCE_COMPLETION_TRIGGER_CHARACTERS,
  sourceCompletionContextAt,
  sourceCompletionEntries,
  sourceCompletionMatchesToken,
} from "../editor/source-completions";
import {
  apiSuggestionTargetFromDiagnosticMessage,
  replacementTextForSuggestionTarget,
  titleForSuggestionTarget,
} from "../editor/source-diagnostic-fixes";
import { sourceDiagnosticFromError } from "../editor/source-diagnostics";
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
  editorPreferences: {
    defaultGraphHints: boolean;
    savedGraphHints: boolean;
    recoveredGraphHints: boolean;
  };
  apiHints: {
    globalCompletions: number;
    methodCompletions: number;
    easeCompletions: number;
    methodDifference: boolean;
    methodPartialCompletion: string;
    methodPartialSnippet: string;
    methodPartialScope: string;
    methodFuzzyCompletion: string;
    easingPartialCompletion: string;
    easingPartialSnippet: string;
    easingPartialScope: string;
    completionTriggers: string;
    slabSnippet: string;
    sphereSnippet: string;
    signatureChecks: number;
    sphere: string;
    translate: string;
    easing: string;
  };
  editorTools: {
    prettifiedLines: number;
    runtimeErrorLine: number;
    runtimeErrorColumn: number;
    runtimeErrorEndColumn: number;
    runtimeErrorSuggestion: string;
    globalErrorColumn: number;
    globalErrorSuggestion: string;
    easingErrorColumn: number;
    easingErrorSuggestion: string;
    propertyOnlyErrorLine: number;
    propertyOnlyErrorColumn: number;
    quickFixTitle: string;
    quickFixReplacement: string;
    easingQuickFixReplacement: string;
    syntaxErrorLine: number;
    syntaxErrorColumn: number;
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
  const apiHints = verifyApiHints(errors);
  const editorTools = verifyEditorTools(errors);
  const selectionRestore = verifySelectionRestore(errors);
  let selectedNode = "";

  const { sdf } = evaluateSource(fixtureSource);
  const links = findGraphSourceLinks(fixtureSource, sdf);
  const sourceInlayHints = verifySourceInlayHints(fixtureSource, links, errors);
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
    (link, value, options) => {
      if (link.nodeKind !== "sphere" || link.label !== "radius") return;
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
      graphSourceHoverDecorations,
      recursiveDecorationWarnings: recursiveDecorationMessages.length,
      sourceScrub,
      sourceLinkHitTest,
      sourceInlayHints,
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
    if (node) codeEditor?.markSelectedSourceLink(link);
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

function verifyApiHints(errors: string[]): EditorRuntimeVerification["apiHints"] {
  const globalCompletions = apiCompletionEntriesForScope("global");
  const methodCompletions = apiCompletionEntriesForScope("method");
  const easeCompletions = apiCompletionEntriesForScope("ease");
  const globalNames = new Set(globalCompletions.map((entry) => entry.name));
  const methodNames = new Set(methodCompletions.map((entry) => entry.name));
  const easeNames = new Set(easeCompletions.map((entry) => entry.name));
  const sphere = apiReferenceForWord("sphere");
  const translate = apiReferenceForWord("translate");
  const linear = apiReferenceForWord("linear");

  if (globalCompletions.length < 35) errors.push(`api hints only exposed ${globalCompletions.length} global completions`);
  if (methodCompletions.length < 20) errors.push(`api hints only exposed ${methodCompletions.length} method completions`);
  if (easeCompletions.length < 30) errors.push(`api hints only exposed ${easeCompletions.length} ease completions`);
  if (!globalNames.has("sphere")) errors.push("api hints missing sphere global completion");
  if (!globalNames.has("save")) errors.push("api hints missing save workflow completion");
  if (globalNames.has("translate")) errors.push("api hints leaked translate into global completions");
  if (!methodNames.has("translate")) errors.push("api hints missing translate method completion");
  if (!methodNames.has("difference")) errors.push("api hints missing chained difference completion");
  if (methodNames.has("sphere")) errors.push("api hints leaked sphere into method completions");
  if (!easeNames.has("linear")) errors.push("api hints missing ease.linear completion");
  if (easeNames.has("sphere")) errors.push("api hints leaked sphere into ease completions");
  if (!sphere?.signature.includes("sphere(")) errors.push("api hints missing sphere signature");
  if (translate?.kind !== "method") errors.push(`api hints classified translate as ${translate?.kind ?? "missing"}`);
  if (!linear?.signature.includes("ease.linear")) errors.push("api hints missing ease.linear signature");
  const spherePartial = firstCompletionForSource("return sph", 1, 11);
  if (spherePartial.first !== "sphere") errors.push(`sph completion first offered ${spherePartial.first || "nothing"}`);
  if (spherePartial.insertText !== "sphere(${1:radius})$0") {
    errors.push(`sphere snippet rendered ${spherePartial.insertText || "nothing"}`);
  }
  const slabPartial = firstCompletionForSource("return sla", 1, 11);
  if (slabPartial.first !== "slab") errors.push(`sla completion first offered ${slabPartial.first || "nothing"}`);
  if (slabPartial.insertText !== "slab(${1:{ x0, x1, y0, y1, z0, z1, k \\}})$0") {
    errors.push(`slab snippet rendered ${slabPartial.insertText || "nothing"}`);
  }
  const methodPartial = firstCompletionForSource("const f = sphere(1)\nreturn f.diffe", 2, 15);
  if (methodPartial.context.scope !== "method") errors.push(`f.diffe completion used ${methodPartial.context.scope} scope`);
  if (methodPartial.first !== "difference") errors.push(`f.diffe completion first offered ${methodPartial.first || "nothing"}`);
  if (methodPartial.insertText !== "difference(${1:rest})$0") {
    errors.push(`f.diffe snippet rendered ${methodPartial.insertText || "nothing"}`);
  }
  const methodFuzzy = firstCompletionForSource("const f = sphere(1)\nreturn f.dff", 2, 13);
  if (methodFuzzy.first !== "difference") errors.push(`f.dff completion first offered ${methodFuzzy.first || "nothing"}`);
  if (!SOURCE_COMPLETION_TRIGGER_CHARACTERS.includes("e") || !SOURCE_COMPLETION_TRIGGER_CHARACTERS.includes(".")) {
    errors.push("api hints completion triggers do not keep member suggestions live");
  }
  const easingPartial = firstCompletionForSource("return sphere(ease.lin)", 1, 23);
  if (easingPartial.context.scope !== "ease") errors.push(`ease.lin completion used ${easingPartial.context.scope} scope`);
  if (easingPartial.first !== "linear") errors.push(`ease.lin completion first offered ${easingPartial.first || "nothing"}`);
  if (easingPartial.insertText !== "linear(${1:t})$0") {
    errors.push(`ease.lin snippet rendered ${easingPartial.insertText || "nothing"}`);
  }
  const signatureChecks = verifyApiSignatureHelp(errors);

  return {
    globalCompletions: globalCompletions.length,
    methodCompletions: methodCompletions.length,
    easeCompletions: easeCompletions.length,
    methodDifference: methodNames.has("difference"),
    methodPartialCompletion: methodPartial.first,
    methodPartialSnippet: methodPartial.insertText,
    methodPartialScope: methodPartial.context.scope,
    methodFuzzyCompletion: methodFuzzy.first,
    easingPartialCompletion: easingPartial.first,
    easingPartialSnippet: easingPartial.insertText,
    easingPartialScope: easingPartial.context.scope,
    completionTriggers: SOURCE_COMPLETION_TRIGGER_CHARACTERS.join(""),
    slabSnippet: slabPartial.insertText,
    sphereSnippet: spherePartial.insertText,
    signatureChecks,
    sphere: sphere?.signature ?? "",
    translate: translate?.signature ?? "",
    easing: linear?.signature ?? "",
  };
}

function firstCompletionForSource(
  source: string,
  lineNumber: number,
  column: number,
): { context: ReturnType<typeof sourceCompletionContextAt>; first: string; insertText: string } {
  const context = sourceCompletionContextAt(source, lineNumber, column);
  const first = sourceCompletionEntries(context)
    .filter((entry) => sourceCompletionMatchesToken(entry, context.token))
    .sort((left, right) => left.sortText.localeCompare(right.sortText))[0];
  return {
    context,
    first: first?.entry.name ?? "",
    insertText: first?.insertText ?? "",
  };
}

function verifyEditorTools(errors: string[]): EditorRuntimeVerification["editorTools"] {
  const pretty = prettifySource("return sphere(1).translate([1,2,3]).difference(box(0.5))");
  if (!pretty.includes("\n  .translate([1, 2, 3])")) {
    errors.push("prettify did not space vector args and wrap translate chain");
  }
  if (!pretty.includes("\n  .difference(box(0.5))")) {
    errors.push("prettify did not wrap difference chain");
  }

  const runtimeSource = "return sphere(1).diffe(sphere(2))";
  const runtimeDiagnostic = diagnosticForSource(runtimeSource, errors, "runtime typo");
  if (runtimeDiagnostic.lineNumber !== 1) {
    errors.push(`runtime typo diagnostic line ${runtimeDiagnostic.lineNumber}`);
  }
  if (runtimeDiagnostic.column !== 18 || runtimeDiagnostic.endColumn !== 23) {
    errors.push(`runtime typo diagnostic column ${runtimeDiagnostic.column}`);
  }
  if (!runtimeDiagnostic.message.includes("difference")) {
    errors.push(`runtime typo diagnostic suggestion ${runtimeDiagnostic.message}`);
  }
  const runtimeQuickFixTarget = apiSuggestionTargetFromDiagnosticMessage(runtimeDiagnostic.message);
  const runtimeQuickFixReplacement = runtimeQuickFixTarget
    ? replacementTextForSuggestionTarget(runtimeQuickFixTarget)
    : "";
  const runtimeQuickFixTitle = runtimeQuickFixTarget ? titleForSuggestionTarget(runtimeQuickFixTarget) : "";
  if (runtimeQuickFixTarget !== ".difference" || runtimeQuickFixReplacement !== "difference") {
    errors.push(`runtime typo quick fix ${runtimeQuickFixTarget ?? "missing"} -> ${runtimeQuickFixReplacement}`);
  }

  const globalSource = "return spere(1)";
  const globalDiagnostic = diagnosticForSource(globalSource, errors, "global typo");
  if (globalDiagnostic.lineNumber !== 1 || globalDiagnostic.column !== 8 || globalDiagnostic.endColumn !== 13) {
    errors.push(`global typo diagnostic range ${globalDiagnostic.lineNumber}:${globalDiagnostic.column}-${globalDiagnostic.endColumn}`);
  }
  if (!globalDiagnostic.message.includes("sphere")) {
    errors.push(`global typo diagnostic suggestion ${globalDiagnostic.message}`);
  }

  const easingSource = "return sphere(ease.linera(0.5))";
  const easingDiagnostic = diagnosticForSource(easingSource, errors, "easing typo");
  if (easingDiagnostic.lineNumber !== 1 || easingDiagnostic.column !== 20 || easingDiagnostic.endColumn !== 26) {
    errors.push(`easing typo diagnostic range ${easingDiagnostic.lineNumber}:${easingDiagnostic.column}-${easingDiagnostic.endColumn}`);
  }
  if (!easingDiagnostic.message.includes("ease.linear")) {
    errors.push(`easing typo diagnostic suggestion ${easingDiagnostic.message}`);
  }
  const easingQuickFixTarget = apiSuggestionTargetFromDiagnosticMessage(easingDiagnostic.message);
  const easingQuickFixReplacement = easingQuickFixTarget
    ? replacementTextForSuggestionTarget(easingQuickFixTarget)
    : "";
  if (easingQuickFixTarget !== "ease.linear" || easingQuickFixReplacement !== "linear") {
    errors.push(`easing typo quick fix ${easingQuickFixTarget ?? "missing"} -> ${easingQuickFixReplacement}`);
  }

  const propertyOnlySource = "const diffe = sphere(0.2)\nreturn sphere(1).diffe(diffe)";
  const propertyOnlyDiagnostic = sourceDiagnosticFromError(
    new TypeError("sphere(...).diffe is not a function"),
    propertyOnlySource,
  );
  if (
    propertyOnlyDiagnostic.lineNumber !== 2
    || propertyOnlyDiagnostic.column !== 18
    || propertyOnlyDiagnostic.endColumn !== 23
  ) {
    errors.push(`property typo diagnostic range ${propertyOnlyDiagnostic.lineNumber}:${propertyOnlyDiagnostic.column}-${propertyOnlyDiagnostic.endColumn}`);
  }
  if (!propertyOnlyDiagnostic.message.includes(".difference")) {
    errors.push(`property typo diagnostic suggestion ${propertyOnlyDiagnostic.message}`);
  }

  const syntaxSource = "const radius = ;\nreturn sphere(1)";
  const syntaxDiagnostic = diagnosticForSource(syntaxSource, errors, "syntax typo");
  if (syntaxDiagnostic.lineNumber !== 1) {
    errors.push(`syntax typo diagnostic line ${syntaxDiagnostic.lineNumber}`);
  }
  if (syntaxDiagnostic.column < 14) {
    errors.push(`syntax typo diagnostic column ${syntaxDiagnostic.column}`);
  }

  return {
    prettifiedLines: pretty.split("\n").length,
    runtimeErrorLine: runtimeDiagnostic.lineNumber,
    runtimeErrorColumn: runtimeDiagnostic.column,
    runtimeErrorEndColumn: runtimeDiagnostic.endColumn,
    runtimeErrorSuggestion: runtimeDiagnostic.message,
    globalErrorColumn: globalDiagnostic.column,
    globalErrorSuggestion: globalDiagnostic.message,
    easingErrorColumn: easingDiagnostic.column,
    easingErrorSuggestion: easingDiagnostic.message,
    propertyOnlyErrorLine: propertyOnlyDiagnostic.lineNumber,
    propertyOnlyErrorColumn: propertyOnlyDiagnostic.column,
    quickFixTitle: runtimeQuickFixTitle,
    quickFixReplacement: runtimeQuickFixReplacement,
    easingQuickFixReplacement,
    syntaxErrorLine: syntaxDiagnostic.lineNumber,
    syntaxErrorColumn: syntaxDiagnostic.column,
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

function verifyEditorPreferences(errors: string[]): EditorRuntimeVerification["editorPreferences"] {
  const storage = new MemoryStorage();
  const defaults = loadEditorPreferences(storage);
  if (defaults.graphHintsEnabled !== true) {
    errors.push("editor preferences did not default graph hints on");
  }

  saveEditorPreferences({ graphHintsEnabled: false }, storage);
  const saved = loadEditorPreferences(storage);
  if (saved.graphHintsEnabled !== false) {
    errors.push("editor preferences did not persist disabled graph hints");
  }

  storage.setItem("sdf-browser-editor-preferences-v1", "{");
  const recovered = loadEditorPreferences(storage);
  if (recovered.graphHintsEnabled !== true) {
    errors.push("editor preferences did not recover from invalid storage");
  }

  return {
    defaultGraphHints: defaults.graphHintsEnabled,
    savedGraphHints: saved.graphHintsEnabled,
    recoveredGraphHints: recovered.graphHintsEnabled,
  };
}

function diagnosticForSource(
  source: string,
  errors: string[],
  label: string,
): ReturnType<typeof sourceDiagnosticFromError> {
  try {
    evaluateSource(source);
  } catch (error) {
    return sourceDiagnosticFromError(error, source);
  }
  errors.push(`${label} unexpectedly compiled`);
  return sourceDiagnosticFromError(new Error(`${label} unexpectedly compiled`), source);
}

function verifyApiSignatureHelp(errors: string[]): number {
  const checks: Array<{ line: string; signature: string; active: number; params: number }> = [
    { line: "return sphere(1, ^)", signature: "sphere(", active: 1, params: 2 },
    { line: "return sphere(1).translate([0, ^])", signature: "shape.translate(", active: 0, params: 1 },
    { line: "return left.union(sphere(1), ^)", signature: "union(", active: 1, params: 3 },
    { line: "return ease.in_out_sine(^)", signature: "ease.in_out_sine(", active: 0, params: 1 },
  ];

  for (const check of checks) {
    const column = check.line.indexOf("^") + 1;
    const line = check.line.replace("^", "");
    const help = apiSignatureHelpAt(line, column);
    if (!help) {
      errors.push(`signature help missing for ${line}`);
      continue;
    }
    if (!help.entry.signature.includes(check.signature)) {
      errors.push(`signature help for ${line} showed ${help.entry.signature}`);
    }
    if (help.activeParameter !== check.active) {
      errors.push(`signature help for ${line} active param ${help.activeParameter}`);
    }
    if (help.parameters.length !== check.params) {
      errors.push(`signature help for ${line} parameter count ${help.parameters.length}`);
    }
  }

  const noHelp = apiSignatureHelpAt("return left + right", "return left + right".length + 1);
  if (noHelp) errors.push(`signature help appeared outside a call: ${noHelp.entry.name}`);
  const bareEase = apiSignatureHelpAt("return linear(", "return linear(".length + 1);
  if (bareEase) errors.push(`signature help treated bare easing as ${bareEase.entry.name}`);
  return checks.length;
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
