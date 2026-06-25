import { findGraphSourceLinks } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import { graphNodeIdentityKeyForNode, sourceLinkForGraphNodeIdentityKey } from "../editor/graph-source-identity";
import { renderSourceDialog } from "../editor/source-dialog";
import {
  clearSourceDraft,
  listSavedSourceDocuments,
  loadSavedSourceVersion,
  loadSourceDraft,
  saveSourceDraft,
  saveSourceVersion,
  type SavedSourceDocument,
  type SavedSourcePreview,
} from "../editor/workspace-storage";
import { examples } from "../examples";

export interface SourceDialogRuntimeVerification {
  initialCards: number;
  chainMatches: string[];
  savedMatches: string[];
  emptyMessages: string[];
  enterLoadedExample: string;
  enterLoadedSaved: string;
  keyboardExampleFocus: string;
  keyboardSavedFirstFocus: string;
  keyboardSavedNextFocus: string;
  activeExampleCurrent: string;
  activeLatestSavedCurrent: string;
  activeOlderSavedCurrent: string;
  activeOlderVersionsOpen: boolean;
  loadedExample: string;
  loadedSaved: string;
}

export interface WorkspaceStorageRuntimeVerification {
  savedHiddenKeys: string[];
  draftHiddenKeys: string[];
  normalizedHiddenKeys: string[];
  savedLayout: string;
  draftLayout: string;
  legacyLayout: string;
  shiftedIdentityRestored: string;
  shiftedLegacyRestored: string;
  draftCleared: boolean;
}

export function verifySourceDialog(errors: string[]): SourceDialogRuntimeVerification {
  const root = document.createElement("div");
  document.body.append(root);
  const savedDocuments: SavedSourceDocument[] = [{
    id: "saved-vessel",
    name: "Saved Vessel",
    updatedAt: "2026-06-10T09:00:00.000Z",
    versions: [
      { id: "version-latest", createdAt: "2026-06-10T09:00:00.000Z", source: "return sphere(1)" },
      { id: "version-old", createdAt: "2026-06-09T09:00:00.000Z", source: "return box(1)" },
    ],
  }];
  let loadedExample = "";
  let loadedSaved = "";

  renderSourceDialog(root, {
    examples,
    savedDocuments,
    activeExampleId: examples[0]?.id ?? "",
    activeDocumentId: null,
    activeVersionId: null,
  }, {
    loadExample(id) {
      loadedExample = id;
    },
    loadSaved(documentId, versionId) {
      loadedSaved = `${documentId}:${versionId}`;
    },
    deleteDocument() {},
    deleteVersion() {},
  });

  const search = root.querySelector<HTMLInputElement>(".source-search-input");
  if (!search) {
    errors.push("source dialog search input did not render");
    root.remove();
    return {
      initialCards: 0,
      chainMatches: [],
      savedMatches: [],
      emptyMessages: [],
      enterLoadedExample: "",
      enterLoadedSaved: "",
      keyboardExampleFocus: "",
      keyboardSavedFirstFocus: "",
      keyboardSavedNextFocus: "",
      activeExampleCurrent: "",
      activeLatestSavedCurrent: "",
      activeOlderSavedCurrent: "",
      activeOlderVersionsOpen: false,
      loadedExample,
      loadedSaved,
    };
  }

  const initialCards = sourceCardLabels(root).length;
  const activeExampleCurrent = currentSourceTargets(root).join(",");
  if (initialCards < examples.length + savedDocuments.length) {
    errors.push(`source dialog rendered too few cards: ${initialCards}`);
  }
  if (activeExampleCurrent !== `source-card:${examples[0]?.name ?? ""}`) {
    errors.push(`source dialog current example was ${activeExampleCurrent || "nothing"}`);
  }

  search.value = "chain";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const chainMatches = sourceCardLabels(root);
  if (!chainMatches.includes("Chain links")) errors.push("source dialog search did not find Chain links");
  if (chainMatches.includes("CSG example")) errors.push("source dialog search left unrelated example visible");
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  const keyboardExampleFocus = focusedSourceButtonTarget(root);
  if (keyboardExampleFocus !== "source-card:Chain links") {
    errors.push(`source dialog ArrowDown focused ${keyboardExampleFocus || "nothing"}`);
  }
  search.focus();
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const enterLoadedExample = loadedExample;
  if (enterLoadedExample !== "chain") {
    errors.push(`source dialog Enter example load emitted ${enterLoadedExample || "nothing"}`);
  }
  loadedExample = "";
  clickSourceCard(root, "Chain links");
  if (loadedExample !== "chain") errors.push(`source dialog example load emitted ${loadedExample || "nothing"}`);

  search.value = "saved";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const savedMatches = sourceCardLabels(root);
  if (!savedMatches.includes("Saved Vessel")) errors.push("source dialog search did not find saved shape");
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  const keyboardSavedFirstFocus = focusedSourceButtonTarget(root);
  if (keyboardSavedFirstFocus !== "source-card:Saved Vessel") {
    errors.push(`source dialog saved ArrowDown focused ${keyboardSavedFirstFocus || "nothing"}`);
  }
  const savedVersions = root.querySelector<HTMLDetailsElement>(".source-versions");
  if (savedVersions) savedVersions.open = true;
  const focusedSavedButton = document.activeElement;
  if (focusedSavedButton instanceof HTMLButtonElement) {
    focusedSavedButton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  }
  const keyboardSavedNextFocus = focusedSourceButtonTarget(root);
  if (keyboardSavedNextFocus !== "source-version-button:Saved Vessel") {
    errors.push(`source dialog saved next focus was ${keyboardSavedNextFocus || "nothing"}`);
  }
  search.focus();
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const enterLoadedSaved = loadedSaved;
  if (enterLoadedSaved !== "saved-vessel:version-latest") {
    errors.push(`source dialog Enter saved load emitted ${enterLoadedSaved || "nothing"}`);
  }
  loadedSaved = "";
  clickSourceCard(root, "Saved Vessel");
  if (loadedSaved !== "saved-vessel:version-latest") {
    errors.push(`source dialog saved load emitted ${loadedSaved || "nothing"}`);
  }

  search.value = "zzzzzzz";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const emptyMessages = [...root.querySelectorAll<HTMLElement>(".source-empty")].map((item) => item.textContent ?? "");
  if (!emptyMessages.includes("No matching examples")) errors.push("source dialog missing no matching examples state");
  if (!emptyMessages.includes("No saved shapes match")) errors.push("source dialog missing no saved matches state");

  renderSourceDialog(root, {
    examples,
    savedDocuments,
    activeExampleId: examples[0]?.id ?? "",
    activeDocumentId: "saved-vessel",
    activeVersionId: "version-latest",
  }, {
    loadExample() {},
    loadSaved() {},
    deleteDocument() {},
    deleteVersion() {},
  });
  const activeLatestSavedCurrent = currentSourceTargets(root).join(",");
  if (activeLatestSavedCurrent !== "source-card:Saved Vessel") {
    errors.push(`source dialog current latest saved was ${activeLatestSavedCurrent || "nothing"}`);
  }

  renderSourceDialog(root, {
    examples,
    savedDocuments,
    activeExampleId: examples[0]?.id ?? "",
    activeDocumentId: "saved-vessel",
    activeVersionId: "version-old",
  }, {
    loadExample() {},
    loadSaved() {},
    deleteDocument() {},
    deleteVersion() {},
  });
  const savedVersionsForCurrent = root.querySelector<HTMLDetailsElement>(".source-versions");
  const activeOlderVersionsOpen = Boolean(savedVersionsForCurrent?.open);
  const activeOlderSavedCurrent = currentSourceTargets(root).join(",");
  if (!activeOlderVersionsOpen) {
    errors.push("source dialog did not expand active older saved version");
  }
  if (activeOlderSavedCurrent !== "source-version-button:Saved Vessel") {
    errors.push(`source dialog current older saved was ${activeOlderSavedCurrent || "nothing"}`);
  }

  root.remove();
  return {
    initialCards,
    chainMatches,
    savedMatches,
    emptyMessages,
    enterLoadedExample,
    enterLoadedSaved,
    keyboardExampleFocus,
    keyboardSavedFirstFocus,
    keyboardSavedNextFocus,
    activeExampleCurrent,
    activeLatestSavedCurrent,
    activeOlderSavedCurrent,
    activeOlderVersionsOpen,
    loadedExample,
    loadedSaved,
  };
}

function sourceCardLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".source-card strong, .source-version-button strong")]
    .map((item) => item.textContent ?? "");
}

function focusedSourceButtonTarget(root: HTMLElement): string {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLButtonElement) || !root.contains(focused)) return "";
  const label = focused.querySelector("strong")?.textContent ?? "";
  return `${focused.className}:${label}`;
}

function currentSourceTargets(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".source-card[aria-current='true'], .source-version-button[aria-current='true']")]
    .map((button) => `${button.className}:${button.querySelector("strong")?.textContent ?? ""}`);
}

function clickSourceCard(root: HTMLElement, label: string): void {
  const target = [...root.querySelectorAll<HTMLButtonElement>(".source-card, .source-version-button")]
    .find((button) => button.querySelector("strong")?.textContent === label);
  target?.click();
}

export function verifyWorkspaceStorage(errors: string[]): WorkspaceStorageRuntimeVerification {
  const storage = new MemoryStorage();
  const normalizedHiddenKeys = ["box:0", "sphere:0"];
  const preview: SavedSourcePreview = {
    bounds: [[-1, -1, -1], [1, 1, 1]],
    meshGrid: 128,
    raySteps: 192,
    meshAlgorithm: "surface-net",
    layout: "quad",
    hiddenNodeKeys: [" sphere:0 ", "box:0", "sphere:0", "", " "],
  };

  const saved = saveSourceVersion("Visibility test", "return sphere(1)", null, preview, storage);
  const loaded = loadSavedSourceVersion(saved.id, null, storage);
  const savedHiddenKeys = loaded?.version.preview?.hiddenNodeKeys ?? [];
  const savedLayout = loaded?.version.preview?.layout ?? "";
  if (!sameStrings(savedHiddenKeys, normalizedHiddenKeys)) {
    errors.push(`saved hidden keys normalized to ${savedHiddenKeys.join(",") || "nothing"}`);
  }
  if (savedLayout !== "quad") errors.push(`saved layout normalized to ${savedLayout || "nothing"}`);

  saveSourceDraft({
    name: "Visibility draft",
    source: "return box(1)",
    preview,
    activeDocumentId: saved.id,
    activeVersionId: loaded?.version.id ?? null,
    activeExampleId: "canonical",
  }, storage);
  const draftPreview = loadSourceDraft(storage)?.preview;
  const draftHiddenKeys = draftPreview?.hiddenNodeKeys ?? [];
  const draftLayout = draftPreview?.layout ?? "";
  if (!sameStrings(draftHiddenKeys, normalizedHiddenKeys)) {
    errors.push(`draft hidden keys normalized to ${draftHiddenKeys.join(",") || "nothing"}`);
  }
  if (draftLayout !== "quad") errors.push(`draft layout normalized to ${draftLayout || "nothing"}`);

  saveSourceVersion("Legacy layout", "return sphere(1)", null, {
    bounds: [[-1, -1, -1], [1, 1, 1]],
    meshGrid: 64,
    raySteps: 176,
    meshAlgorithm: "surface-net",
  } as SavedSourcePreview, storage);
  const legacy = listSavedSourceDocuments(storage).find((document) => document.name === "Legacy layout");
  const legacyLayout = legacy ? loadSavedSourceVersion(legacy.id, null, storage)?.version.preview?.layout ?? "" : "";
  if (legacyLayout !== "single") errors.push(`legacy layout normalized to ${legacyLayout || "nothing"}`);

  const baseSource = "return union(sphere(1), box(1))";
  const shiftedSource = "const pad = sphere(1.25)\nreturn union(sphere(1), box(1))";
  const { sdf: baseSdf } = evaluateSource(baseSource);
  const { sdf: shiftedSdf } = evaluateSource(shiftedSource);
  const baseLinks = findGraphSourceLinks(baseSource, baseSdf);
  const shiftedLinks = findGraphSourceLinks(shiftedSource, shiftedSdf);
  const baseBox = baseLinks.find((link) => link.nodeKind === "box" && link.label === "call");
  const shiftedBox = shiftedLinks.find((link) => link.nodeKind === "box" && link.label === "call");
  const identityKey = baseBox ? graphNodeIdentityKeyForNode(baseLinks, baseBox.nodeId) : null;
  const legacyKey = baseBox ? `box:call:${baseBox.start}:${baseBox.end}` : null;
  const shiftedIdentityLink = identityKey ? sourceLinkForGraphNodeIdentityKey(shiftedLinks, identityKey) : null;
  const shiftedLegacyLink = legacyKey ? sourceLinkForGraphNodeIdentityKey(shiftedLinks, legacyKey) : null;
  const shiftedIdentityRestored = shiftedIdentityLink ? `${shiftedIdentityLink.nodeKind}:${shiftedIdentityLink.start}` : "";
  const shiftedLegacyRestored = shiftedLegacyLink ? `${shiftedLegacyLink.nodeKind}:${shiftedLegacyLink.start}` : "";
  if (!baseBox || !shiftedBox) errors.push("visibility identity fixture missing box link");
  if (!identityKey) errors.push("visibility identity fixture could not create identity key");
  if (shiftedIdentityLink?.nodeId !== shiftedBox?.nodeId) {
    errors.push(`visibility identity restored ${shiftedIdentityRestored || "nothing"}`);
  }
  if (shiftedLegacyLink) errors.push("legacy offset visibility key unexpectedly survived shifted source");

  clearSourceDraft(storage);
  const draftCleared = loadSourceDraft(storage) == null;
  if (!draftCleared) errors.push("clearing source draft left saved visibility draft behind");

  return {
    savedHiddenKeys,
    draftHiddenKeys,
    normalizedHiddenKeys,
    savedLayout,
    draftLayout,
    legacyLayout,
    shiftedIdentityRestored,
    shiftedLegacyRestored,
    draftCleared,
  };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
