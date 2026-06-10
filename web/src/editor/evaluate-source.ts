import * as api from "../api";
import { SDF3 } from "../core/nodes";

const runtime = {
  ...api,
  Math,
};

export interface SourceResult {
  sdf: SDF3;
}

export function evaluateSource(source: string): SourceResult {
  const names = Object.keys(runtime);
  const values = names.map((name) => runtime[name as keyof typeof runtime]);
  const fn = new Function(...names, `"use strict";\n${source}`);
  const result = fn(...values);
  if (!(result instanceof SDF3)) {
    throw new Error("Editor code must return an SDF3.");
  }
  return { sdf: result };
}
