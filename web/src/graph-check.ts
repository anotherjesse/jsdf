import { runGraphRuntimeVerification } from "./verify/graph-runtime";

const root = document.querySelector<HTMLElement>("#graphInspector")!;
const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runGraphRuntimeVerification(root);
    document.body.dataset.status = result.ok ? "pass" : "fail";
    document.title = result.ok ? "graph-check pass" : "graph-check fail";
    status.textContent = result.ok ? "Graph inspector verification passed." : "Graph inspector verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfGraphVerification?: unknown }).__sdfGraphVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    document.title = "graph-check fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "Graph inspector verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfGraphVerification?: unknown }).__sdfGraphVerification = {
      ok: false,
      errors: [message],
    };
  }
}
