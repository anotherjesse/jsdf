import { runMeshRuntimeVerification } from "./verify/mesh-runtime";

const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runMeshRuntimeVerification();
    document.body.dataset.status = result.ok ? "pass" : "fail";
    status.textContent = result.ok ? "Mesh runtime verification passed." : "Mesh runtime verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfMeshVerification?: unknown }).__sdfMeshVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "Mesh runtime verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfMeshVerification?: unknown }).__sdfMeshVerification = {
      ok: false,
      errors: [message],
    };
  }
}
