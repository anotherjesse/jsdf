import { runAppHealthRuntimeVerification } from "./verify/app-health-runtime";

const frame = document.querySelector<HTMLIFrameElement>("#appFrame")!;
const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLPreElement>("#report")!;

void main();

async function main(): Promise<void> {
  try {
    const result = await runAppHealthRuntimeVerification(frame);
    document.body.dataset.status = result.ok ? "pass" : "fail";
    document.title = result.ok ? "app-health-check pass" : "app-health-check fail";
    status.textContent = result.ok ? "App health verification passed." : "App health verification failed.";
    report.textContent = JSON.stringify(result, null, 2);
    (window as typeof window & { __sdfAppHealthVerification?: unknown }).__sdfAppHealthVerification = result;
  } catch (error) {
    document.body.dataset.status = "fail";
    document.title = "app-health-check fail";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = "App health verification crashed.";
    report.textContent = message;
    (window as typeof window & { __sdfAppHealthVerification?: unknown }).__sdfAppHealthVerification = {
      ok: false,
      errors: [message],
    };
  }
}
