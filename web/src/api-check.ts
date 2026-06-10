import { runApiRuntimeVerification } from "./verify/api-runtime";

const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runApiRuntimeVerification();
    document.body.dataset.status = result.ok ? "pass" : "fail";
    status.textContent = result.ok ? "API runtime verification passed." : "API runtime verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfApiVerification?: unknown }).__sdfApiVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "API runtime verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfApiVerification?: unknown }).__sdfApiVerification = {
      ok: false,
      errors: [message],
    };
  }
}
