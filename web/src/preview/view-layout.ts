export type PreviewLayout = "single" | "quad";

export interface ViewPanel {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  direction: [number, number, number] | null;
}

export function viewPanels(layout: PreviewLayout, width: number, height: number): ViewPanel[] {
  if (layout === "single") {
    return [{ x: 0, y: 0, width, height, label: "Orbit", direction: null }];
  }

  const gap = 2;
  const leftWidth = Math.floor((width - gap) / 2);
  const rightWidth = width - gap - leftWidth;
  const bottomHeight = Math.floor((height - gap) / 2);
  const topHeight = height - gap - bottomHeight;
  const topY = bottomHeight + gap;
  const rightX = leftWidth + gap;

  return [
    { x: 0, y: topY, width: leftWidth, height: topHeight, label: "Orbit", direction: null },
    { x: rightX, y: topY, width: rightWidth, height: topHeight, label: "Top Z", direction: [0, 0, 1] },
    { x: 0, y: 0, width: leftWidth, height: bottomHeight, label: "Right X", direction: [1, 0, 0] },
    { x: rightX, y: 0, width: rightWidth, height: bottomHeight, label: "Front Y", direction: [0, 1, 0] },
  ];
}
