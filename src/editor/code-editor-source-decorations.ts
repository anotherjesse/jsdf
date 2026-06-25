import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { GraphSourceLink } from "./clean-source-patch";
import { sourceLinkHoverMessage } from "./source-link-status-bar";

type SourceLinkDecorationKind = "hovered" | "selected" | "edited" | "revealed";

const SOURCE_LINK_DECORATION_STYLES: Record<SourceLinkDecorationKind, { className: string; zIndex: number }> = {
  hovered: { className: "source-hovered-link", zIndex: 30 },
  selected: { className: "source-selected-link", zIndex: 40 },
  edited: { className: "source-edited-link", zIndex: 50 },
  revealed: { className: "source-revealed-link", zIndex: 45 },
};

export function sourceLinkKey(link: GraphSourceLink | null): string | null {
  return link ? `${link.nodeId}:${link.label}:${link.start}:${link.end}` : null;
}

export function rangeForSourceLink(
  editor: monaco.editor.IStandaloneCodeEditor,
  link: GraphSourceLink,
): monaco.Range | null {
  return sourceLinkRange(editor.getModel(), link);
}

export function clearSourceLinkDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  decorations: string[],
): string[] {
  return editor.deltaDecorations(decorations, []);
}

export function updateSourceLinkDecoration(
  editor: monaco.editor.IStandaloneCodeEditor,
  decorations: string[],
  link: GraphSourceLink | null,
  kind: SourceLinkDecorationKind,
): string[] {
  const range = link ? rangeForSourceLink(editor, link) : null;
  if (!range) return clearSourceLinkDecorations(editor, decorations);

  const style = SOURCE_LINK_DECORATION_STYLES[kind];
  return editor.deltaDecorations(decorations, [{
    range,
    options: {
      className: style.className,
      inlineClassName: style.className,
      zIndex: style.zIndex,
    },
  }]);
}

export function updateFocusedSourceLinkDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  decorations: string[],
  links: readonly GraphSourceLink[],
): string[] {
  return editor.deltaDecorations(decorations, links.flatMap((link) => {
    const range = rangeForSourceLink(editor, link);
    if (!range) return [];
    return [{
      range,
      options: {
        className: "source-focused-link",
        inlineClassName: "source-focused-link",
        zIndex: 10,
      },
    }];
  }));
}

export function updateGraphSourceLinkDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  decorations: string[],
  links: readonly GraphSourceLink[],
  isNumberLink: (link: GraphSourceLink) => boolean,
): string[] {
  return editor.deltaDecorations(decorations, links.flatMap((link) => {
    const range = rangeForSourceLink(editor, link);
    if (!range) return [];
    const isNumber = isNumberLink(link);
    return [{
      range,
      options: {
        inlineClassName: `source-graph-link ${isNumber ? "source-number-link" : "source-node-link"}`,
        hoverMessage: {
          value: sourceLinkHoverMessage(link, isNumber),
        },
      },
    }];
  }));
}

function sourceLinkRange(model: monaco.editor.ITextModel | null, link: GraphSourceLink): monaco.Range | null {
  if (!model || link.end <= link.start) return null;
  const start = model.getPositionAt(link.start);
  const end = model.getPositionAt(link.end);
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}
