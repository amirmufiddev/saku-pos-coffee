// electron/run-electron.ts
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildElectronArtifacts } from "./build-electron.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function launchElectron(): void {
  const electronBinary = require("electron") as string;
  const mainEntry = path.join(projectRoot, "dist-electron/main.mjs");

  const electronProcess = spawn(electronBinary, [mainEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  electronProcess.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

async function main(): Promise<void> {
  await buildElectronArtifacts();
  setTimeout(launchElectron, 3000);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
