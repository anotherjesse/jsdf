import * as api from "../api";
import {
  API_REFERENCE_SEEDS,
  type ApiCompletionScope,
  type ApiReferenceSeed,
  type ApiSymbolKind,
} from "./api-reference-data";

export interface ApiReferenceEntry extends ApiReferenceSeed {
  name: string;
  completionScopes: readonly ApiCompletionScope[];
}

const apiExports = api as Record<string, unknown>;

let cachedEntries: ApiReferenceEntry[] | null = null;
let cachedDynamicSeeds: Record<string, ApiReferenceSeed> | null = null;

export function apiCompletionEntries(): ApiReferenceEntry[] {
  cachedEntries ??= buildEntries();
  return cachedEntries;
}

export function apiCompletionEntriesForScope(scope: ApiCompletionScope): ApiReferenceEntry[] {
  return apiCompletionEntries().filter((entry) => entry.completionScopes.includes(scope));
}

export function apiReferenceForWord(word: string): ApiReferenceEntry | null {
  const seed = referenceSeedForWord(word);
  const hasExport = Object.prototype.hasOwnProperty.call(apiExports, word);
  if (!seed && !hasExport) return null;
  const kind = seed?.kind ?? inferKind(word, apiExports[word]);
  return {
    name: word,
    kind,
    group: seed?.group ?? inferGroup(word, apiExports[word]),
    signature: seed?.signature ?? inferSignature(word, apiExports[word]),
    description: seed?.description ?? inferDescription(word, apiExports[word]),
    completionScopes: seed?.completionScopes ?? defaultCompletionScopes(kind),
  };
}

function buildEntries(): ApiReferenceEntry[] {
  const names = new Set([
    ...Object.keys(apiExports),
    ...Object.keys(API_REFERENCE_SEEDS),
    ...Object.keys(dynamicReferenceSeeds()),
  ]);
  return Array.from(names)
    .map((name) => apiReferenceForWord(name))
    .filter((entry): entry is ApiReferenceEntry => entry != null)
    .sort((a, b) => {
      const groupDelta = groupRank(a.group) - groupRank(b.group);
      return groupDelta || a.name.localeCompare(b.name);
    });
}

function referenceSeedForWord(word: string): ApiReferenceSeed | undefined {
  return API_REFERENCE_SEEDS[word] ?? dynamicReferenceSeeds()[word];
}

function dynamicReferenceSeeds(): Record<string, ApiReferenceSeed> {
  if (cachedDynamicSeeds) return cachedDynamicSeeds;
  const seeds: Record<string, ApiReferenceSeed> = {};
  const easing = apiExports.ease;
  if (easing && typeof easing === "object") {
    for (const name of Object.keys(easing).sort()) {
      seeds[name] = {
        kind: "function",
        group: "Easing",
        signature: `ease.${name}(t): number`,
        description: "Easing function for bend, transition, extrusion, and wrap parameters.",
        completionScopes: ["ease"],
      };
    }
  }
  cachedDynamicSeeds = seeds;
  return seeds;
}

function inferKind(name: string, value: unknown): ApiSymbolKind {
  if (name === "ease") return "namespace";
  if (/^[A-Z][A-Za-z0-9]*$/.test(name) && typeof value === "function") return "class";
  if (typeof value === "function") return "function";
  if (value && typeof value === "object") return "namespace";
  return "constant";
}

function inferGroup(name: string, value: unknown): string {
  const kind = inferKind(name, value);
  if (kind === "class") return "Classes";
  if (kind === "namespace") return "Namespaces";
  if (kind === "constant" || /^[A-Z0-9_]+$/.test(name)) return "Math";
  return "Helpers";
}

function inferSignature(name: string, value: unknown): string {
  const kind = inferKind(name, value);
  if (kind === "class") return `class ${name}`;
  if (kind === "namespace") return `const ${name}`;
  if (kind === "constant") return `const ${name}`;
  return `${name}(...)`;
}

function inferDescription(name: string, value: unknown): string {
  const kind = inferKind(name, value);
  if (kind === "constant") return "Constant exported by the browser SDF API.";
  if (kind === "class") return "Class exported by the browser SDF API.";
  if (kind === "namespace") return "Namespace-style value exported by the browser SDF API.";
  return "Helper exported by the browser SDF API.";
}

function defaultCompletionScopes(kind: ApiSymbolKind): readonly ApiCompletionScope[] {
  return kind === "method" ? ["method"] : ["global"];
}

function groupRank(group: string): number {
  const order = [
    "3D Primitives",
    "2D Primitives",
    "CSG",
    "Transforms",
    "2D/3D",
    "Workflow",
    "Math",
    "Easing",
    "Classes",
    "Namespaces",
    "Helpers",
  ];
  const index = order.indexOf(group);
  return index === -1 ? order.length : index;
}
