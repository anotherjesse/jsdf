import * as api from "../api";
import { SDF3 } from "../core/nodes";
import { sourceWithAutoReturnExpression } from "./source-auto-return";

const runtime = {
  ...api,
  Math,
};

export interface SourceResult {
  sdf: SDF3;
  autoReturned: boolean;
}

export function evaluateSource(source: string): SourceResult {
  const direct = runSource(source);
  if (direct instanceof SDF3) return { sdf: direct, autoReturned: false };

  const autoReturn = sourceWithAutoReturnExpression(source);
  if (autoReturn) {
    const autoReturned = runSource(autoReturn.source);
    if (autoReturned instanceof SDF3) return { sdf: autoReturned, autoReturned: true };
  }

  throw new Error("Editor code must return an SDF3.");
}

function runSource(source: string): unknown {
  const names = Object.keys(runtime);
  const values = names.map((name) => runtime[name as keyof typeof runtime]);
  const fn = new Function(...names, `"use strict";\n${source}\n//# sourceURL=sdf-editor-source.js`);
  return fn(...values);
}
