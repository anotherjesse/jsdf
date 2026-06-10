import { runEditorRuntimeVerification } from "./verify/editor-runtime";

const codeRoot = document.querySelector<HTMLElement>("#codeEditor")!;
const graphRoot = document.querySelector<HTMLElement>("#graphInspector")!;
const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runEditorRuntimeVerification(codeRoot, graphRoot, (step) => {
      status.textContent = `Running editor integration verification: ${step}...`;
    });
    document.body.dataset.status = result.ok ? "pass" : "fail";
    document.title = result.ok ? "editor-check pass" : "editor-check fail";
    status.textContent = result.ok ? "Editor integration verification passed." : "Editor integration verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfEditorVerification?: unknown }).__sdfEditorVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    document.title = "editor-check fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "Editor integration verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfEditorVerification?: unknown }).__sdfEditorVerification = {
      ok: false,
      errors: [message],
    };
  }
}
