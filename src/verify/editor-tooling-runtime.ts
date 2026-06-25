import type { CodeEditor } from "../editor/code-editor";
import { apiCompletionEntriesForScope, apiReferenceForWord } from "../editor/api-reference";
import { apiSignatureHelpAt } from "../editor/api-signature-help";
import { loadEditorPreferences, saveEditorPreferences } from "../editor/editor-preferences";
import { evaluateSource } from "../editor/evaluate-source";
import { prettifySource } from "../editor/prettify-source";
import { sourceWithAutoReturnExpression } from "../editor/source-auto-return";
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

export interface EditorApiHintsVerification {
  globalCompletions: number;
  methodCompletions: number;
  easeCompletions: number;
  methodDifference: boolean;
  methodPartialCompletion: string;
  methodPartialSnippet: string;
  methodPartialScope: string;
  methodFuzzyCompletion: string;
  workflowMethodCompletion: string;
  workflowMethodSnippet: string;
  workflowMethodSignature: string;
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
}

export interface EditorToolsVerification {
  autoReturnExpressionKind: string;
  autoReturnVariableKind: string;
  autoReturnTransform: string;
  explicitReturnAutoReturned: boolean;
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
  danglingMemberErrorLine: number;
  danglingMemberErrorColumn: number;
  trailingDotErrorLine: number;
  trailingDotErrorColumn: number;
  danglingMemberMessage: string;
  quickFixTitle: string;
  quickFixReplacement: string;
  easingQuickFixReplacement: string;
  workflowMethodSuggestion: string;
  quickFixAppliedSource: string;
  danglingQuickFixAppliedSource: string;
  quickFixChangeEvents: number;
  quickFixMarkersBeforeApply: number;
  quickFixMarkersAfterApply: number;
  syntaxErrorLine: number;
  syntaxErrorColumn: number;
}

export interface EditorPreferencesVerification {
  defaultEditorMode: string;
  defaultGraphHints: boolean;
  savedEditorMode: string;
  savedGraphHints: boolean;
  recoveredEditorMode: string;
  recoveredGraphHints: boolean;
}

export function verifyEditorApiHints(errors: string[]): EditorApiHintsVerification {
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
  if (!methodNames.has("generate")) errors.push("api hints missing shape.generate method completion");
  if (!methodNames.has("save")) errors.push("api hints missing shape.save method completion");
  if (!methodNames.has("sample_slice")) errors.push("api hints missing shape.sample_slice method completion");
  if (!methodNames.has("show_slice")) errors.push("api hints missing shape.show_slice method completion");
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
  if (methodPartial.insertText !== "difference(${1:other})$0") {
    errors.push(`f.diffe snippet rendered ${methodPartial.insertText || "nothing"}`);
  }
  const methodFuzzy = firstCompletionForSource("const f = sphere(1)\nreturn f.dff", 2, 13);
  if (methodFuzzy.first !== "difference") errors.push(`f.dff completion first offered ${methodFuzzy.first || "nothing"}`);
  const workflowMethod = firstCompletionForSource("const f = sphere(1)\nreturn f.gener", 2, 15);
  if (workflowMethod.first !== "generate") errors.push(`f.gener completion first offered ${workflowMethod.first || "nothing"}`);
  if (workflowMethod.insertText !== "generate(${1:options})$0") {
    errors.push(`f.gener snippet rendered ${workflowMethod.insertText || "nothing"}`);
  }
  if (!workflowMethod.signature.startsWith("shape.generate(")) {
    errors.push(`f.gener detail rendered ${workflowMethod.signature || "nothing"}`);
  }
  const saveMethod = firstCompletionForSource("const f = sphere(1)\nreturn f.sav", 2, 13);
  if (saveMethod.first !== "save") errors.push(`f.sav completion first offered ${saveMethod.first || "nothing"}`);
  if (saveMethod.insertText !== "save(${1:filename})$0") {
    errors.push(`f.sav snippet rendered ${saveMethod.insertText || "nothing"}`);
  }
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
    workflowMethodCompletion: workflowMethod.first,
    workflowMethodSnippet: workflowMethod.insertText,
    workflowMethodSignature: workflowMethod.signature,
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

export function verifyEditorTools(errors: string[]): EditorToolsVerification {
  const autoReturnExpression = evaluateSource("sphere(0.75)");
  if (!autoReturnExpression.autoReturned || autoReturnExpression.sdf.node.kind !== "sphere") {
    errors.push("expression-only source did not auto-return a sphere");
  }

  const autoReturnVariableSource = "const f = sphere(0.4).translate([0.1, 0, 0])\nf";
  const autoReturnVariable = evaluateSource(autoReturnVariableSource);
  const autoReturnTransform = sourceWithAutoReturnExpression(autoReturnVariableSource)?.source ?? "";
  if (!autoReturnVariable.autoReturned || autoReturnVariable.sdf.node.kind !== "translate") {
    errors.push("final variable source did not auto-return the composed SDF");
  }
  if (!autoReturnTransform.includes("\nreturn f;")) {
    errors.push("auto-return transform did not preserve final variable expression");
  }

  const explicitReturn = evaluateSource("return sphere(0.5)");
  if (explicitReturn.autoReturned) {
    errors.push("explicit return source was incorrectly marked as auto-returned");
  }

  const pretty = prettifySource("return sphere(1).translate([1,2,3]).difference(box(0.5))");
  if (!pretty.includes("\n  .translate([1, 2, 3])")) {
    errors.push("prettify did not space vector args and wrap translate chain");
  }
  if (!pretty.includes("\n  .difference(box(0.5))")) {
    errors.push("prettify did not wrap difference chain");
  }
  const expressionPretty = prettifySource("sphere(1).translate([1,2,3]).difference(box(0.5))");
  if (!expressionPretty.startsWith("sphere(1)\n  .translate([1, 2, 3])")) {
    errors.push(`prettify expression-only source rendered ${expressionPretty}`);
  }
  const assignmentPretty = prettifySource("let f=sphere(1)\nf=f.difference(box(0.5)).translate([0,1,0])\nf");
  if (!assignmentPretty.includes("let f = sphere(1)")) {
    errors.push(`prettify assignment declaration rendered ${assignmentPretty}`);
  }
  if (!assignmentPretty.includes("f = f\n  .difference(box(0.5))\n  .translate([0, 1, 0])")) {
    errors.push(`prettify reassignment chain rendered ${assignmentPretty}`);
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

  const workflowMethodSource = "return sphere(1).generte()";
  const workflowMethodDiagnostic = sourceDiagnosticFromError(
    new TypeError("sphere(...).generte is not a function"),
    workflowMethodSource,
  );
  if (
    workflowMethodDiagnostic.lineNumber !== 1
    || workflowMethodDiagnostic.column !== 18
    || workflowMethodDiagnostic.endColumn !== 25
  ) {
    errors.push(`workflow method typo diagnostic range ${workflowMethodDiagnostic.lineNumber}:${workflowMethodDiagnostic.column}-${workflowMethodDiagnostic.endColumn}`);
  }
  if (!workflowMethodDiagnostic.message.includes(".generate")) {
    errors.push(`workflow method typo diagnostic suggestion ${workflowMethodDiagnostic.message}`);
  }

  const syntaxSource = "const radius = ;\nreturn sphere(1)";
  const syntaxDiagnostic = diagnosticForSource(syntaxSource, errors, "syntax typo");
  if (syntaxDiagnostic.lineNumber !== 1) {
    errors.push(`syntax typo diagnostic line ${syntaxDiagnostic.lineNumber}`);
  }
  if (syntaxDiagnostic.column < 14) {
    errors.push(`syntax typo diagnostic column ${syntaxDiagnostic.column}`);
  }

  const danglingMemberSource = "let f = sphere(1)\nf . \nreturn f";
  const danglingMemberDiagnostic = diagnosticForSource(danglingMemberSource, errors, "dangling member access");
  if (
    danglingMemberDiagnostic.lineNumber !== 2
    || danglingMemberDiagnostic.column !== 3
    || danglingMemberDiagnostic.endColumn !== 4
  ) {
    errors.push(`dangling member diagnostic range ${danglingMemberDiagnostic.lineNumber}:${danglingMemberDiagnostic.column}-${danglingMemberDiagnostic.endColumn}`);
  }
  if (!danglingMemberDiagnostic.message.includes("Trailing dot")) {
    errors.push(`dangling member diagnostic message ${danglingMemberDiagnostic.message}`);
  }

  const trailingDotSource = "return sphere(1).";
  const trailingDotDiagnostic = diagnosticForSource(trailingDotSource, errors, "trailing member access");
  if (
    trailingDotDiagnostic.lineNumber !== 1
    || trailingDotDiagnostic.column !== 17
    || trailingDotDiagnostic.endColumn !== 18
  ) {
    errors.push(`trailing dot diagnostic range ${trailingDotDiagnostic.lineNumber}:${trailingDotDiagnostic.column}-${trailingDotDiagnostic.endColumn}`);
  }
  if (!trailingDotDiagnostic.message.includes("Trailing dot")) {
    errors.push(`trailing dot diagnostic message ${trailingDotDiagnostic.message}`);
  }

  return {
    autoReturnExpressionKind: autoReturnExpression.sdf.node.kind,
    autoReturnVariableKind: autoReturnVariable.sdf.node.kind,
    autoReturnTransform,
    explicitReturnAutoReturned: explicitReturn.autoReturned,
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
    danglingMemberErrorLine: danglingMemberDiagnostic.lineNumber,
    danglingMemberErrorColumn: danglingMemberDiagnostic.column,
    trailingDotErrorLine: trailingDotDiagnostic.lineNumber,
    trailingDotErrorColumn: trailingDotDiagnostic.column,
    danglingMemberMessage: danglingMemberDiagnostic.message,
    quickFixTitle: runtimeQuickFixTitle,
    quickFixReplacement: runtimeQuickFixReplacement,
    easingQuickFixReplacement,
    workflowMethodSuggestion: workflowMethodDiagnostic.message,
    quickFixAppliedSource: "",
    danglingQuickFixAppliedSource: "",
    quickFixChangeEvents: 0,
    quickFixMarkersBeforeApply: -1,
    quickFixMarkersAfterApply: -1,
    syntaxErrorLine: syntaxDiagnostic.lineNumber,
    syntaxErrorColumn: syntaxDiagnostic.column,
  };
}

export function verifyCodeEditorQuickFix(
  codeEditor: CodeEditor,
  editorTools: EditorToolsVerification,
  sourceChangeEvents: string[],
  errors: string[],
): void {
  const source = "return sphere(1).diffe(sphere(2))";
  const beforeChangeEvents = sourceChangeEvents.length;
  const diagnostic = diagnosticForSource(source, errors, "editor quick fix typo");
  codeEditor.setValue(source);
  codeEditor.setError(diagnostic);
  editorTools.quickFixMarkersBeforeApply = codeEditor.runtimeDiagnosticCount();
  if (editorTools.quickFixMarkersBeforeApply !== 1) {
    errors.push(`editor quick fix started with ${editorTools.quickFixMarkersBeforeApply} markers`);
  }
  if (!codeEditor.applyPreferredQuickFix()) {
    errors.push("editor quick fix did not apply");
  }
  editorTools.quickFixAppliedSource = codeEditor.getValue();
  editorTools.quickFixChangeEvents = sourceChangeEvents.length - beforeChangeEvents;
  editorTools.quickFixMarkersAfterApply = codeEditor.runtimeDiagnosticCount();
  if (!editorTools.quickFixAppliedSource.includes(".difference(sphere(2))")) {
    errors.push(`editor quick fix source was ${editorTools.quickFixAppliedSource}`);
  }
  if (editorTools.quickFixChangeEvents !== 1) {
    errors.push(`editor quick fix emitted ${editorTools.quickFixChangeEvents} change events`);
  }
  if (editorTools.quickFixMarkersAfterApply !== 0) {
    errors.push(`editor quick fix left ${editorTools.quickFixMarkersAfterApply} markers`);
  }

  const danglingSource = "let f = sphere(1)\nf . \nreturn f";
  const danglingDiagnostic = diagnosticForSource(danglingSource, errors, "editor dangling quick fix");
  codeEditor.setValue(danglingSource);
  codeEditor.setError(danglingDiagnostic);
  if (codeEditor.runtimeDiagnosticCount() !== 1) {
    errors.push(`dangling quick fix started with ${codeEditor.runtimeDiagnosticCount()} markers`);
  }
  if (!codeEditor.applyPreferredQuickFix()) {
    errors.push("dangling quick fix did not apply");
  }
  editorTools.danglingQuickFixAppliedSource = codeEditor.getValue();
  if (codeEditor.runtimeDiagnosticCount() !== 0) {
    errors.push(`dangling quick fix left ${codeEditor.runtimeDiagnosticCount()} markers`);
  }
  if (editorTools.danglingQuickFixAppliedSource.includes("f .")) {
    errors.push(`dangling quick fix source was ${editorTools.danglingQuickFixAppliedSource}`);
  }
  try {
    const fixed = evaluateSource(editorTools.danglingQuickFixAppliedSource);
    if (fixed.sdf.node.kind !== "sphere") {
      errors.push(`dangling quick fix compiled ${fixed.sdf.node.kind}`);
    }
  } catch (error) {
    errors.push(`dangling quick fix did not compile: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function verifyEditorPreferences(errors: string[]): EditorPreferencesVerification {
  const storage = new MemoryStorage();
  const defaults = loadEditorPreferences(storage);
  if (defaults.editorMode !== "simple") {
    errors.push(`editor preferences defaulted to ${defaults.editorMode} mode`);
  }
  if (defaults.graphHintsEnabled !== false) {
    errors.push("editor preferences did not default graph hints off");
  }

  saveEditorPreferences({ editorMode: "advanced", graphHintsEnabled: false }, storage);
  const saved = loadEditorPreferences(storage);
  if (saved.editorMode !== "advanced") {
    errors.push(`editor preferences did not persist advanced mode`);
  }
  if (saved.graphHintsEnabled !== false) {
    errors.push("editor preferences did not persist disabled graph hints");
  }

  storage.setItem("sdf-browser-editor-preferences-v1", "{");
  const recovered = loadEditorPreferences(storage);
  if (recovered.editorMode !== "simple") {
    errors.push(`editor preferences recovered to ${recovered.editorMode} mode`);
  }
  if (recovered.graphHintsEnabled !== false) {
    errors.push("editor preferences did not recover from invalid storage");
  }

  return {
    defaultEditorMode: defaults.editorMode,
    defaultGraphHints: defaults.graphHintsEnabled,
    savedEditorMode: saved.editorMode,
    savedGraphHints: saved.graphHintsEnabled,
    recoveredEditorMode: recovered.editorMode,
    recoveredGraphHints: recovered.graphHintsEnabled,
  };
}

function firstCompletionForSource(
  source: string,
  lineNumber: number,
  column: number,
): { context: ReturnType<typeof sourceCompletionContextAt>; first: string; insertText: string; signature: string } {
  const context = sourceCompletionContextAt(source, lineNumber, column);
  const first = sourceCompletionEntries(context)
    .filter((entry) => sourceCompletionMatchesToken(entry, context.token))
    .sort((left, right) => left.sortText.localeCompare(right.sortText))[0];
  return {
    context,
    first: first?.entry.name ?? "",
    insertText: first?.insertText ?? "",
    signature: first?.signature ?? "",
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
    { line: "return left.union(sphere(1), ^)", signature: "shape.union(", active: 1, params: 2 },
    { line: "return sphere(1).generate(^)", signature: "shape.generate(", active: 0, params: 1 },
    { line: "return sphere(1).save(\"part.stl\", ^)", signature: "shape.save(", active: 1, params: 2 },
    { line: "return save(\"part.stl\", sphere(1), ^)", signature: "save(", active: 2, params: 3 },
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
    if (!help.signature.includes(check.signature)) {
      errors.push(`signature help for ${line} showed ${help.signature}`);
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
