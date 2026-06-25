import { runPreviewRuntimeVerification } from "./verify/preview-runtime";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runPreviewRuntimeVerification(canvas);
    document.body.dataset.status = result.ok ? "pass" : "fail";
    status.textContent = result.ok ? "Preview runtime verification passed." : "Preview runtime verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfPreviewVerification?: unknown }).__sdfPreviewVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "Preview runtime verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfPreviewVerification?: unknown }).__sdfPreviewVerification = {
      ok: false,
      errors: [message],
    };
  }
}
