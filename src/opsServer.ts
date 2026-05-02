import Fastify from "fastify";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { syncRules, getStreamState } from "./streamLoop.js";
import { supabase, setKillSwitch, getRuntimeConfig } from "./supabase.js";

export async function startOpsServer() {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const secret = req.headers["x-ops-secret"];
    if (secret !== config.opsSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => {
    const s = getStreamState();
    return {
      ok: true,
      stream_status: s.status,
      reconnects_24h: s.reconnects24h,
      rule_set_hash: s.ruleSetHash,
      last_error: s.lastError,
    };
  });

  // PKG-PULS-02A: kill-switch przez RPC, zero direct write do puls_worker_state
  app.post("/admin/kill-switch", async (req) => {
    const body = (req.body ?? {}) as { tripped?: boolean; reason?: string };
    const tripped = body.tripped ?? true;
    const reason = body.reason ?? null;
    const result = await setKillSwitch(tripped, reason);
    return result;
  });

  app.post("/admin/reset-month-counter", async (req) => {
    const body = (req.body ?? {}) as { reason?: string };
    const reason = body.reason || "manual ops reset";
    const { error } = await supabase.rpc("admin_reset_puls_month_counter", { p_reason: reason });
    if (error) throw error;
    return { ok: true };
  });

  // PKG-PULS-05A: guard enabled=false aktywny.
  // Jeśli moduł PULS jest globalnie wyłączony, /admin/resync-rules nie woła X API.
  // Ten endpoint nie może zmusić workera do dotknięcia X gdy enabled=false.
  app.post("/admin/resync-rules", async () => {
    const cfg = await getRuntimeConfig();
    if (!cfg.enabled) {
      return { ok: false, skipped: "enabled=false" };
    }
    const r = await syncRules();
    return { ok: true, ...r };
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "ops server listening");
}
