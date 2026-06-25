import type { SDF3 } from "../core/nodes";
import type { Bounds3 } from "../mesh/bounds";
import { currentExample } from "../examples";
import type { GraphSourceLink } from "./clean-source-patch";
import {
  graphNodeIdentityKeyForNode,
  sourceLinkForGraphNodeIdentityKey,
} from "./graph-source-identity";
import type { SavedSourcePreview } from "./workspace-storage";

export type PreviewProfile = SavedSourcePreview;

const FALLBACK_BOUNDS: Bounds3 = [[-4, -4, -4], [4, 4, 4]];

export interface PreviewProfileInput {
  bounds: Bounds3;
  meshGrid: number;
  raySteps: number;
  meshAlgorithm: PreviewProfile["meshAlgorithm"];
  layout: PreviewProfile["layout"];
  hiddenNodeKeys: readonly string[];
}

export function createPreviewProfile(input: PreviewProfileInput): PreviewProfile {
  return {
    bounds: cloneBounds(input.bounds) as PreviewProfile["bounds"],
    meshGrid: input.meshGrid,
    raySteps: input.raySteps,
    meshAlgorithm: input.meshAlgorithm,
    layout: input.layout,
    ...(input.hiddenNodeKeys.length > 0 ? { hiddenNodeKeys: [...input.hiddenNodeKeys] } : {}),
  };
}

export function hiddenNodeKeysForGraph(
  hiddenNodeIds: ReadonlySet<number>,
  pendingHiddenNodeKeys: readonly string[],
  sourceLinks: readonly GraphSourceLink[],
): string[] {
  if (hiddenNodeIds.size === 0) return [...pendingHiddenNodeKeys].sort();
  const keys = [...hiddenNodeIds]
    .map((nodeId) => graphNodeIdentityKeyForNode(sourceLinks, nodeId))
    .filter((key): key is string => key != null);
  return [...new Set(keys)].sort();
}

export function hiddenNodeIdsFromKeys(
  keys: readonly string[],
  links: readonly GraphSourceLink[],
  sdf: SDF3,
): number[] {
  if (keys.length === 0) return [];
  const wanted = new Set(keys);
  const ids: number[] = [];
  for (const key of wanted) {
    const link = sourceLinkForGraphNodeIdentityKey(links, key);
    if (link && link.nodeId !== sdf.node.id) ids.push(link.nodeId);
  }
  return [...new Set(ids)];
}

export function previewProfileSnapshot(profile: PreviewProfile): string {
  return JSON.stringify(profile);
}

export function boundsForExample(id: string): Bounds3 {
  return cloneBounds((currentExample(id).bounds ?? FALLBACK_BOUNDS) as Bounds3);
}

export function cloneBounds(bounds: Bounds3): Bounds3 {
  return [
    [bounds[0][0], bounds[0][1], bounds[0][2]],
    [bounds[1][0], bounds[1][1], bounds[1][2]],
  ];
}
