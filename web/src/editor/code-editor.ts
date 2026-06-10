import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/min/vs/editor/editor.main.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as api from "../api";

interface MonacoEnvironment {
  getWorker(): Worker;
}

(globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

monaco.languages.registerCompletionItemProvider("javascript", {
  triggerCharacters: ["."],
  provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    return {
      suggestions: apiCompletionNames().map((name) => ({
        label: name,
        kind: /^[A-Z0-9_]+$/.test(name)
          ? monaco.languages.CompletionItemKind.Variable
          : monaco.languages.CompletionItemKind.Function,
        insertText: name,
        range,
      })),
    };
  },
});

export interface CodeEditor {
  setValue(value: string): void;
  getValue(): string;
  layout(): void;
  dispose(): void;
}

export function createCodeEditor(element: HTMLElement, initialValue: string, onChange: (value: string) => void): CodeEditor {
  const editor = monaco.editor.create(element, {
    value: initialValue,
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: "on",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    renderLineHighlight: "line",
    padding: { top: 10, bottom: 10 },
  });

  let suppress = false;
  const subscription = editor.onDidChangeModelContent(() => {
    if (!suppress) onChange(editor.getValue());
  });

  return {
    setValue(value: string) {
      suppress = true;
      editor.setValue(value);
      suppress = false;
    },
    getValue() {
      return editor.getValue();
    },
    layout() {
      editor.layout();
    },
    dispose() {
      subscription.dispose();
      editor.dispose();
    },
  };
}

let completionNames: string[] | null = null;

function apiCompletionNames(): string[] {
  completionNames ??= Object.keys(api).sort();
  return completionNames;
}
