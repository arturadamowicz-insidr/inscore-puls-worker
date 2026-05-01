import { logger } from "./logger.js";
import { startStreamLoop, startHeartbeatLoop } from "./streamLoop.js";
import { startResampleLoop } from "./resampleLoop.js";
import { startOpsServer } from "./opsServer.js";

async function main() {
  logger.info("PULS worker starting…");
  await startOpsServer();
  startHeartbeatLoop();
  // Loop A — Filtered Stream (long-lived)
  startStreamLoop().catch(err => logger.fatal({ err: String(err) }, "stream loop crashed"));
  // Loop B — Re-polling
  startResampleLoop().catch(err => logger.fatal({ err: String(err) }, "resample loop crashed"));
}

main().catch(err => {
  logger.fatal({ err: String(err) }, "fatal startup error");
  process.exit(1);
});

process.on("unhandledRejection", (err) => logger.error({ err: String(err) }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err: String(err) }, "uncaughtException"));
