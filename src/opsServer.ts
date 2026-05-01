import Fastify from "fastify";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { syncRules, getStreamState } from "./streamLoop.js";
import { supabase } from "./supabase.js";

export async function startOpsServer() {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const secret = req.headers["x-ops-secret"];
    if (secret !== config.opsSecret) {
      reply.code(401).send({ error: "unauthorized" });
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

  app.post("/admin/kill-switch", async (req) => {
    const body = (req.body ?? {}) as { tripped?: boolean };
    const tripped = body.tripped ?? true;
    const { error } = await supabase
      .from("puls_worker_state")
      .update({ kill_switch_tripped: tripped })
      .eq("id", 1);
    if (error) throw error;
    return { ok: true, kill_switch_tripped: tripped };
  });

  app.post("/admin/reset-month-counter", async (req) => {
    const body = (req.body ?? {}) as { reason?: string };
    const reason = body.reason || "manual ops reset";
    const { error } = await supabase.rpc("admin_reset_puls_month_counter", { p_reason: reason });
    if (error) throw error;
    return { ok: true };
  });

  app.post("/admin/resync-rules", async () => {
    const r = await syncRules();
    return { ok: true, ...r };
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "ops server listening");
}
