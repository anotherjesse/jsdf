export type GraphVisibilityState = "root" | "visible" | "hidden" | "inherited";

export interface GraphVisibilityMeta {
  state: GraphVisibilityState;
  title: string;
  disabled: boolean;
  pressed: boolean;
}

export function graphVisibilityMeta(
  isRoot: boolean,
  directlyHidden: boolean,
  inheritedHidden: boolean,
): GraphVisibilityMeta {
  if (isRoot) {
    return {
      state: "root",
      title: "Root node stays visible",
      disabled: true,
      pressed: true,
    };
  }
  if (directlyHidden) {
    return {
      state: "hidden",
      title: "Show node in preview",
      disabled: false,
      pressed: false,
    };
  }
  if (inheritedHidden) {
    return {
      state: "inherited",
      title: "Hide node; parent is hidden",
      disabled: false,
      pressed: true,
    };
  }
  return {
    state: "visible",
    title: "Hide node in preview",
    disabled: false,
    pressed: true,
  };
}

export function renderEyeIcon(state: GraphVisibilityState): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "eye-icon";
  icon.dataset.state = state;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
