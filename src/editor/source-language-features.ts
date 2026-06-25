import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  apiReferenceForWord,
  apiReferenceSignatureForScope,
  type ApiReferenceEntry,
} from "./api-reference";
import type { ApiCompletionScope } from "./api-reference-data";
import { apiSignatureHelpAt } from "./api-signature-help";
import type { GraphSourceLink } from "./clean-source-patch";
import { prettifySource } from "./prettify-source";
import {
  apiSuggestionTargetFromDiagnosticMessage,
  markerCodeValue,
  replacementTextForSuggestionTarget,
  SDF_API_TYPO_MARKER_CODE,
  SDF_DANGLING_MEMBER_FIX_TITLE,
  SDF_DANGLING_MEMBER_MARKER_CODE,
  titleForSuggestionTarget,
} from "./source-diagnostic-fixes";
import {
  SOURCE_COMPLETION_TRIGGER_CHARACTERS,
  sourceCompletionContextAt,
  sourceCompletionEntries,
} from "./source-completions";
import { sourceInlayHintKeyForLink, sourceInlayHintsForOffsetRange } from "./source-inlay-hints";

export const SDF_RUNTIME_MARKER_OWNER = "sdf-runtime";

const SOURCE_INLAY_HINT_SELECT_COMMAND = "sdf.selectGraphSourceLink";
const sourceInlayHintStateByUri = new Map<string, SourceInlayHintModelState>();
const sourceInlayHintsChanged = new monaco.Emitter<void>();

interface SourceInlayHintModelState {
  links: readonly GraphSourceLink[];
  onSelect(link: GraphSourceLink): void;
}

monaco.languages.registerCompletionItemProvider("javascript", {
  triggerCharacters: [...SOURCE_COMPLETION_TRIGGER_CHARACTERS],
  provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    const context = sourceCompletionContextAt(model.getValue(), position.lineNumber, position.column);
    return {
      suggestions: sourceCompletionEntries(context).map(({ entry, filterText, insertAsSnippet, insertText, matchRank, signature, sortText }) => ({
        label: entry.name,
        kind: completionKindForApiEntry(entry, context.scope),
        insertText,
        ...(insertAsSnippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
        filterText,
        range,
        detail: signature,
        documentation: {
          value: `${entry.description}\n\n_${entry.group}_`,
        },
        preselect: matchRank <= 1 && context.token.length > 0,
        sortText,
      })),
    };
  },
});

monaco.languages.registerDocumentFormattingEditProvider("javascript", {
  provideDocumentFormattingEdits(model) {
    const source = model.getValue();
    const pretty = prettifySource(source);
    if (pretty === source) return [];
    return [{
      range: model.getFullModelRange(),
      text: pretty,
    }];
  },
});

monaco.languages.registerHoverProvider("javascript", {
  provideHover(model: monaco.editor.ITextModel, position: monaco.Position) {
    const word = model.getWordAtPosition(position);
    if (!word) return null;
    const entry = apiReferenceForWord(word.word);
    if (!entry) return null;
    const scope = wordCompletionScopeBefore(model, position, word);
    if (!entry.completionScopes.includes(scope)) {
      return null;
    }
    return {
      range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
      contents: [
        { value: `\`\`\`ts\n${apiReferenceSignatureForScope(entry, scope)}\n\`\`\`` },
        { value: `${entry.description}\n\n_${entry.group}_` },
      ],
    };
  },
});

monaco.languages.registerSignatureHelpProvider("javascript", {
  signatureHelpTriggerCharacters: ["(", ","],
  signatureHelpRetriggerCharacters: [","],
  provideSignatureHelp(model: monaco.editor.ITextModel, position: monaco.Position) {
    const help = apiSignatureHelpAt(model.getLineContent(position.lineNumber), position.column);
    if (!help) return null;
    return {
      value: {
        activeSignature: 0,
        activeParameter: help.activeParameter,
        signatures: [{
          label: help.signature,
          documentation: {
            value: `${help.entry.description}\n\n_${help.entry.group}_`,
          },
          parameters: help.parameters.map((label) => ({ label })),
        }],
      },
      dispose() {},
    };
  },
});

monaco.languages.registerCodeActionProvider("javascript", {
  provideCodeActions(model, range, context) {
    const actions: monaco.languages.CodeAction[] = [];
    for (const marker of context.markers) {
      const markerRange = new monaco.Range(
        marker.startLineNumber,
        marker.startColumn,
        marker.endLineNumber,
        marker.endColumn,
      );
      if (!monaco.Range.areIntersectingOrTouching(markerRange, range)) continue;

      const code = markerCodeValue(marker.code);
      if (code === SDF_DANGLING_MEMBER_MARKER_CODE) {
        actions.push({
          title: SDF_DANGLING_MEMBER_FIX_TITLE,
          kind: "quickfix",
          diagnostics: [marker],
          isPreferred: true,
          edit: {
            edits: [{
              resource: model.uri,
              versionId: model.getVersionId(),
              textEdit: {
                range: markerRange,
                text: "",
              },
            }],
          },
        });
        continue;
      }

      if (code !== SDF_API_TYPO_MARKER_CODE) continue;
      const target = apiSuggestionTargetFromDiagnosticMessage(marker.message);
      if (!target) continue;
      const replacement = replacementTextForSuggestionTarget(target);
      if (!replacement || model.getValueInRange(markerRange) === replacement) continue;
      actions.push({
        title: titleForSuggestionTarget(target),
        kind: "quickfix",
        diagnostics: [marker],
        isPreferred: true,
        edit: {
          edits: [{
            resource: model.uri,
            versionId: model.getVersionId(),
            textEdit: {
              range: markerRange,
              text: replacement,
            },
          }],
        },
      });
    }
    return {
      actions,
      dispose() {},
    };
  },
}, {
  providedCodeActionKinds: ["quickfix"],
});

monaco.languages.registerInlayHintsProvider("javascript", {
  displayName: "SDF graph source links",
  onDidChangeInlayHints: sourceInlayHintsChanged.event,
  provideInlayHints(model, range) {
    const uri = model.uri.toString();
    const links = sourceInlayHintStateByUri.get(uri)?.links ?? [];
    const startOffset = model.getOffsetAt({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    const endOffset = model.getOffsetAt({
      lineNumber: range.endLineNumber,
      column: range.endColumn,
    });
    return {
      hints: sourceInlayHintsForOffsetRange(links, startOffset, endOffset).map((hint) => ({
        label: [{
          label: hint.label,
          tooltip: hint.tooltip,
          command: {
            id: SOURCE_INLAY_HINT_SELECT_COMMAND,
            title: `Select ${hint.tooltip} in graph`,
            arguments: [uri, hint.key],
          },
        }],
        tooltip: hint.tooltip,
        position: model.getPositionAt(hint.offset),
        kind: hint.kind === "param" ? monaco.languages.InlayHintKind.Parameter : monaco.languages.InlayHintKind.Type,
        paddingLeft: true,
        paddingRight: true,
      })),
      dispose() {},
    };
  },
});

monaco.editor.addCommand({
  id: SOURCE_INLAY_HINT_SELECT_COMMAND,
  run(_accessor, uri: string, key: string) {
    const state = sourceInlayHintStateByUri.get(uri);
    const link = state?.links.find((candidate) => sourceInlayHintKeyForLink(candidate) === key);
    if (!link) return;
    state?.onSelect(link);
  },
});

export function setSourceInlayHintState(
  model: monaco.editor.ITextModel,
  links: readonly GraphSourceLink[],
  onSelect: (link: GraphSourceLink) => void,
): void {
  sourceInlayHintStateByUri.set(model.uri.toString(), {
    links: [...links],
    onSelect,
  });
  refreshSourceInlayHints();
}

export function clearSourceInlayHintState(
  model: monaco.editor.ITextModel,
  onSelect: (link: GraphSourceLink) => void,
): void {
  setSourceInlayHintState(model, [], onSelect);
}

export function deleteSourceInlayHintState(model: monaco.editor.ITextModel): void {
  sourceInlayHintStateByUri.delete(model.uri.toString());
  refreshSourceInlayHints();
}

export function refreshSourceInlayHints(): void {
  sourceInlayHintsChanged.fire();
}

function completionKindForApiEntry(
  entry: ApiReferenceEntry,
  scope: ApiCompletionScope = "global",
): monaco.languages.CompletionItemKind {
  if (scope === "method" && entry.completionScopes.includes("method")) return monaco.languages.CompletionItemKind.Method;
  if (entry.kind === "class") return monaco.languages.CompletionItemKind.Class;
  if (entry.kind === "constant") return monaco.languages.CompletionItemKind.Constant;
  if (entry.kind === "method") return monaco.languages.CompletionItemKind.Method;
  if (entry.kind === "namespace") return monaco.languages.CompletionItemKind.Module;
  return monaco.languages.CompletionItemKind.Function;
}

function wordCompletionScopeBefore(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  word: monaco.editor.IWordAtPosition,
): ApiCompletionScope {
  const beforeWord = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
  let dotIndex = beforeWord.length;
  while (dotIndex > 0 && /\s/.test(beforeWord[dotIndex - 1])) dotIndex -= 1;
  if (beforeWord[dotIndex - 1] !== ".") return "global";
  let end = dotIndex - 1;
  while (end > 0 && /\s/.test(beforeWord[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[$\w]/.test(beforeWord[start - 1])) start -= 1;
  return beforeWord.slice(start, end) === "ease" ? "ease" : "method";
}
