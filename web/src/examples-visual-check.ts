import { runExamplesVisualRuntimeVerification } from "./verify/examples-visual-runtime";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const gallery = document.querySelector<HTMLElement>("#gallery")!;
const report = document.querySelector<HTMLElement>("#report")!;
const status = document.querySelector<HTMLElement>("#status")!;

runExamplesVisualRuntimeVerification(canvas, gallery)
  .then((result) => {
    status.textContent = result.ok
      ? `Passed ${result.examples.length} example renders.`
      : `Failed with ${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}.`;
    status.dataset.state = result.ok ? "ok" : "error";
    report.textContent = JSON.stringify(result, null, 2);
    document.title = result.ok ? "examples-visual-check pass" : "examples-visual-check fail";
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = message;
    status.dataset.state = "error";
    report.textContent = JSON.stringify({ ok: false, errors: [message] }, null, 2);
    document.title = "examples-visual-check fail";
  });
