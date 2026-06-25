import { findGraphSourceLinks } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import type { GraphParamEdit } from "../editor/graph-edit-model";
import { GraphInspector } from "../editor/graph-inspector";
import { findNodeByKind } from "./graph-node-runtime";

const ORIENTATION_SOURCE = "return cylinder(0.25).orient(X)";

export function verifyOrientationControl(errors: string[]): void {
  const root = document.createElement("div");
  const { sdf } = evaluateSource(ORIENTATION_SOURCE);
  const links = findGraphSourceLinks(ORIENTATION_SOURCE, sdf);
  const sourceHoverLabels: string[] = [];
  const edits: GraphParamEdit[] = [];
  let revealedSource = "";
  const inspector = new GraphInspector(root, {
    onSelect() {},
    onHover() {},
    onEdit(edit) {
      edits.push(edit);
    },
    onSolo() {},
    onRevealSource(link) {
      revealedSource = `${link.nodeKind}:${link.label}`;
    },
    onSourceHover(link) {
      sourceHoverLabels.push(link ? `${link.nodeKind}:${link.label}` : "");
    },
    onVisibilityChange() {},
  });

  inspector.setSdf(sdf);
  inspector.setSourceLinks(links);
  const rotate = findNodeByKind(sdf.node, "rotate3");
  if (!rotate) {
    errors.push("orientation fixture produced no rotate3 node");
    return;
  }
  inspector.selectNodeById(rotate.id);

  const axis = root.querySelector<HTMLElement>(".axis-control");
  const axisLink = links.find((link) => link.nodeId === rotate.id && link.label === "axis");
  if (!axis) {
    errors.push("orientation control did not render for rotate3 node");
    return;
  }
  if (!axisLink) {
    errors.push("orientation control had no source axis link");
    return;
  }

  axis.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "rotate3:axis") {
    errors.push(`orientation hover emitted ${sourceHoverLabels.at(-1) || "nothing"}`);
  }
  if (!axis.classList.contains("source-hovered")) errors.push("orientation hover did not mark itself");
  axis.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "") errors.push("orientation leave did not clear source hover");
  if (axis.classList.contains("source-hovered")) errors.push("orientation leave kept local hover");

  axis.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "rotate3:axis") errors.push("orientation focus did not emit source hover");
  if (!axis.classList.contains("source-hovered")) errors.push("orientation focus did not mark itself");
  axis.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  if (sourceHoverLabels.at(-1) !== "") errors.push("orientation blur did not clear source hover");
  if (axis.classList.contains("source-hovered")) errors.push("orientation blur kept local hover");

  inspector.setHoveredSourceLink(axisLink);
  if (!root.querySelector(".axis-control.source-hovered")) errors.push("source hover did not mark orientation control");
  inspector.setHoveredSourceLink(null);
  if (root.querySelector(".axis-control.source-hovered")) errors.push("clearing source hover left orientation marked");

  const customButton = [...axis.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Custom");
  if (!customButton) {
    errors.push("orientation control had no custom matrix button");
    return;
  }
  customButton.click();

  const matrixControl = root.querySelector<HTMLElement>(".matrix-control");
  const matrixInputs = [...root.querySelectorAll<HTMLInputElement>(".matrix-grid input")];
  if (!matrixControl) {
    errors.push("custom orientation did not render matrix grid");
    return;
  }
  if (matrixInputs.length !== 9) {
    errors.push(`custom orientation rendered ${matrixInputs.length} matrix inputs`);
  }
  const expectedMatrixLabel = `rotate3 #${rotate.id} orientation matrix row 1 column 2`;
  if (matrixInputs[1]?.getAttribute("aria-label") !== expectedMatrixLabel) {
    errors.push(`custom matrix input label rendered ${matrixInputs[1]?.getAttribute("aria-label") || "nothing"}`);
  }

  const matrixSourceButton = matrixControl.querySelector<HTMLButtonElement>(".matrix-source-link");
  if (!matrixSourceButton) {
    errors.push("custom orientation matrix had no source reveal button");
  } else {
    const expectedLabel = `Reveal rotate3 #${rotate.id} orientation in code`;
    if (matrixSourceButton.getAttribute("aria-label") !== expectedLabel) {
      errors.push(`matrix source reveal label rendered ${matrixSourceButton.getAttribute("aria-label") || "nothing"}`);
    }
    matrixSourceButton.click();
    if (revealedSource !== "rotate3:axis") errors.push(`matrix source reveal emitted ${revealedSource || "nothing"}`);
  }

  const firstOffDiagonal = matrixInputs[1];
  if (!firstOffDiagonal) return;
  firstOffDiagonal.dispatchEvent(new FocusEvent("focus"));
  firstOffDiagonal.value = "0.25";
  firstOffDiagonal.dispatchEvent(new Event("input", { bubbles: true }));
  firstOffDiagonal.dispatchEvent(new FocusEvent("blur"));
  const lastEdit = edits.at(-1);
  if (!lastEdit || lastEdit.nodeId !== rotate.id || lastEdit.label !== "matrix[0][1]" || lastEdit.nextValue !== 0.25) {
    errors.push(`custom matrix edit emitted ${lastEdit ? `${lastEdit.label}:${String(lastEdit.nextValue)}` : "nothing"}`);
  }
  if (inspector.getParamValue(rotate.id, ["matrix", 0, 1]) !== 0.25) {
    errors.push("custom matrix edit did not update graph param");
  }
}
