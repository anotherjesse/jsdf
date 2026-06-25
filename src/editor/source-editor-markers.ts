import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { SourceDiagnostic } from "./source-diagnostics";
import {
  apiSuggestionTargetFromDiagnosticMessage,
  markerCodeValue,
  replacementTextForSuggestionTarget,
  SDF_API_TYPO_MARKER_CODE,
  SDF_DANGLING_MEMBER_MARKER_CODE,
} from "./source-diagnostic-fixes";
import { SDF_RUNTIME_MARKER_OWNER } from "./source-language-features";

export type CodeEditorError = string | SourceDiagnostic;

export function setEditorRuntimeError(
  editor: monaco.editor.IStandaloneCodeEditor,
  error: CodeEditorError | null,
): void {
  const model = editor.getModel();
  if (!model) return;
  monaco.editor.setModelMarkers(model, SDF_RUNTIME_MARKER_OWNER, error
    ? [markerForEditorError(error, model)]
    : []);
}

export function runtimeDiagnosticCount(editor: monaco.editor.IStandaloneCodeEditor): number {
  const model = editor.getModel();
  if (!model) return 0;
  return monaco.editor.getModelMarkers({
    owner: SDF_RUNTIME_MARKER_OWNER,
    resource: model.uri,
  }).length;
}

export function applyPreferredQuickFix(editor: monaco.editor.IStandaloneCodeEditor): boolean {
  const model = editor.getModel();
  const marker = preferredQuickFixMarker(editor);
  if (!model || !marker) return false;
  const replacement = preferredQuickFixText(marker);
  if (replacement == null) return false;

  const range = markerRange(marker);
  if (model.getValueInRange(range) === replacement) return false;
  const startOffset = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
  editor.executeEdits("sdf.quickFix", [{
    range,
    text: replacement,
    forceMoveMarkers: true,
  }]);
  const endPosition = model.getPositionAt(startOffset + replacement.length);
  const selection = new monaco.Range(range.startLineNumber, range.startColumn, endPosition.lineNumber, endPosition.column);
  editor.setSelection(selection);
  editor.revealRangeInCenterIfOutsideViewport(selection);
  monaco.editor.setModelMarkers(model, SDF_RUNTIME_MARKER_OWNER, []);
  editor.focus();
  return true;
}

function preferredQuickFixMarker(editor: monaco.editor.IStandaloneCodeEditor): monaco.editor.IMarker | null {
  const model = editor.getModel();
  if (!model) return null;
  const markers = monaco.editor.getModelMarkers({
    owner: SDF_RUNTIME_MARKER_OWNER,
    resource: model.uri,
  }).filter((marker) => {
    return preferredQuickFixText(marker) != null;
  });
  if (markers.length === 0) return null;

  const selection = editor.getSelection();
  if (!selection) return markers[0] ?? null;
  const selectionRange = new monaco.Range(
    selection.startLineNumber,
    selection.startColumn,
    selection.endLineNumber,
    selection.endColumn,
  );
  return markers.find((marker) => {
    return monaco.Range.areIntersectingOrTouching(markerRange(marker), selectionRange);
  }) ?? markers[0] ?? null;
}

function preferredQuickFixText(marker: monaco.editor.IMarker): string | null {
  const code = markerCodeValue(marker.code);
  if (code === SDF_DANGLING_MEMBER_MARKER_CODE) return "";
  if (code !== SDF_API_TYPO_MARKER_CODE) return null;
  const target = apiSuggestionTargetFromDiagnosticMessage(marker.message);
  return target ? replacementTextForSuggestionTarget(target) : null;
}

function markerRange(marker: monaco.editor.IMarker): monaco.Range {
  return new monaco.Range(
    marker.startLineNumber,
    marker.startColumn,
    marker.endLineNumber,
    marker.endColumn,
  );
}

function markerForEditorError(
  error: CodeEditorError,
  model: monaco.editor.ITextModel,
): monaco.editor.IMarkerData {
  if (typeof error === "string") {
    return {
      severity: monaco.MarkerSeverity.Error,
      message: error,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: Math.max(2, model.getLineLength(1) + 1),
    };
  }
  const lineNumber = clamp(error.lineNumber, 1, model.getLineCount());
  const endLineNumber = clamp(error.endLineNumber, lineNumber, model.getLineCount());
  const lineLength = model.getLineLength(lineNumber);
  const column = clamp(error.column, 1, Math.max(1, lineLength + 1));
  const endColumn = clamp(error.endColumn, column + 1, Math.max(column + 1, model.getLineLength(endLineNumber) + 1));
  const marker: monaco.editor.IMarkerData = {
    severity: monaco.MarkerSeverity.Error,
    message: error.message,
    startLineNumber: lineNumber,
    startColumn: column,
    endLineNumber,
    endColumn,
  };
  if (error.code) {
    marker.code = error.code;
  } else if (apiSuggestionTargetFromDiagnosticMessage(error.message)) {
    marker.code = SDF_API_TYPO_MARKER_CODE;
  }
  return marker;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
