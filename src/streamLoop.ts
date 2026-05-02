import { request } from "undici";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  addStreamRules,
  buildRulesFromHandles,
  deleteStreamRules,
  getStreamRules,
  sleep,
} from "./xApi.js";
import { getActiveHandles, getRuntimeConfig, heartbeat, upsertTrackedPost } from "./supabase.js";

type StreamEvent = {
  data?: {
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics?: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      quote_count: number;
      impression_count?: number;
    };
  };
  includes?: { users?: Array<{ id: string; username: string }> };
};

type LoopState = {
  abort: AbortController | null;
  ruleSetHash: string | null;
  handleToInsiderId: Map<string, string>;
  status: "connected" | "reconnecting" | "down" | "paused";
  reconnects24h: number;
  lastError: string | null;
};

const state: LoopState = {
  abort: null,
  ruleSetHash: null,
  handleToInsiderId: new Map(),
  status: "down",
  reconnects24h: 0,
  lastError: null,
};

export function getStreamState() {
  return { ...state, abort: null };
}

export async function syncRules(): Promise<{ changed: boolean; hash: string; count: number }> {
  const active = await getActiveHandles();
  state.handleToInsiderId = new Map(active.handles.map(h => [h.handle.replace(/^@/, "").toLowerCase(), h.id]));

  if (active.rule_set_hash === state.ruleSetHash) {
    return { changed: false, hash: active.rule_set_hash, count: active.count };
  }

  // Wipe and re-create
  const existing = await getStreamRules();
  if (existing.length > 0) await deleteStreamRules(existing.map(r => r.id));
  const rules = buildRulesFromHandles(active.handles);
  if (rules.length > 0) await addStreamRules(rules);

  state.ruleSetHash = active.rule_set_hash;
  logger.info({ rules: rules.length, handles: active.count }, "stream rules synced");
  return { changed: true, hash: active.rule_set_hash, count: active.count };
}

export async function startStreamLoop() {
  let backoffMs = 1000;

  // periodic rule resync — PKG-PULS-02A: skip when disabled to avoid X API side-effects
  setInterval(async () => {
    try {
      const cfg = await getRuntimeConfig();
      if (!cfg.enabled) {
        logger.debug("auto-resync skipped: enabled=false");
        return;
      }
      await syncRules();
    } catch (err) {
      logger.error({ err: String(err) }, "rule resync failed");
    }
  }, config.ruleResyncIntervalMs);

  while (true) {
    try {
      const cfg = await getRuntimeConfig();
      if (!cfg.enabled || cfg.kill_switch_tripped) {
        state.status = "paused";
        state.lastError = cfg.kill_switch_tripped ? "kill_switch_tripped" : "disabled";
        await sleep(15_000);
        continue;
      }

      await syncRules();
      state.status = "reconnecting";

      const url = "https://api.twitter.com/2/tweets/search/stream"
        + "?expansions=author_id"
        + "&tweet.fields=created_at,public_metrics,author_id"
        + "&user.fields=username";

      const ac = new AbortController();
      state.abort = ac;

      const res = await request(url, {
        headers: { authorization: `Bearer ${config.xBearerToken}` },
        signal: ac.signal,
      });

      if (res.statusCode !== 200) {
        const body = await res.body.text();
        throw new Error(`stream HTTP ${res.statusCode}: ${body.slice(0, 500)}`);
      }

      state.status = "connected";
      state.lastError = null;
      backoffMs = 1000;
      logger.info("stream connected");

      let buf = "";
      for await (const chunk of res.body) {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as StreamEvent;
            await handleStreamEvent(ev);
          } catch (e) {
            logger.warn({ err: String(e), line: line.slice(0, 200) }, "stream parse error");
          }
        }
      }

      throw new Error("stream ended");
    } catch (err) {
      state.status = "reconnecting";
      state.lastError = String(err);
      state.reconnects24h += 1;
      logger.warn({ err: String(err), backoffMs }, "stream disconnected, backing off");
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}

async function handleStreamEvent(ev: StreamEvent) {
  if (!ev.data) return;
  const username = ev.includes?.users?.find(u => u.id === ev.data!.author_id)?.username;
  if (!username) {
    logger.warn({ post: ev.data.id }, "stream event missing username");
    return;
  }
  const insiderId = state.handleToInsiderId.get(username.toLowerCase());
  if (!insiderId) {
    logger.debug({ username, post: ev.data.id }, "stream event for unknown insider, skip");
    return;
  }
  const m = ev.data.public_metrics;
  await upsertTrackedPost(
    ev.data.id,
    insiderId,
    username,
    ev.data.created_at,
    m ? {
      like_count: m.like_count,
      retweet_count: m.retweet_count,
      reply_count: m.reply_count,
      quote_count: m.quote_count,
      impression_count: m.impression_count ?? null,
    } : undefined,
  );
}

export async function startHeartbeatLoop() {
  setInterval(async () => {
    try {
      await heartbeat(state.status, state.lastError, state.ruleSetHash);
    } catch (err) {
      logger.error({ err: String(err) }, "heartbeat failed");
    }
  }, config.heartbeatIntervalMs);
}
