import { request } from "undici";
import { config } from "./config.js";
import { logger } from "./logger.js";

const X_BASE = "https://api.twitter.com/2";

function authHeaders() {
  return { authorization: `Bearer ${config.xBearerToken}` };
}

// ── Stream rules ──────────────────────────────────────────────────────────────
export type StreamRule = { value: string; tag?: string };

export async function getStreamRules(): Promise<Array<{ id: string; value: string; tag?: string }>> {
  const res = await request(`${X_BASE}/tweets/search/stream/rules`, { headers: authHeaders() });
  const body = (await res.body.json()) as { data?: Array<{ id: string; value: string; tag?: string }> };
  if (res.statusCode >= 400) throw new Error(`X rules GET ${res.statusCode}: ${JSON.stringify(body)}`);
  return body.data ?? [];
}

export async function deleteStreamRules(ids: string[]) {
  if (ids.length === 0) return;
  const res = await request(`${X_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ delete: { ids } }),
  });
  const body = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`X rules DELETE ${res.statusCode}: ${body}`);
}

export async function addStreamRules(rules: StreamRule[]) {
  if (rules.length === 0) return;
  const res = await request(`${X_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ add: rules }),
  });
  const body = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`X rules ADD ${res.statusCode}: ${body}`);
}

// Build chunked from:@h1 OR from:@h2 ... rules (max 25 handles per rule by convention)
export function buildRulesFromHandles(handles: Array<{ id: string; handle: string }>, chunkSize = 25): StreamRule[] {
  const clean = handles.map(h => h.handle.replace(/^@/, "").trim()).filter(Boolean);
  const rules: StreamRule[] = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const value = chunk.map(h => `from:${h}`).join(" OR ") + " -is:retweet -is:reply";
    rules.push({ value, tag: `puls-chunk-${Math.floor(i / chunkSize)}` });
  }
  return rules;
}

// ── Tweet lookup (re-polling metrics) ────────────────────────────────────────
export type TweetLookup = {
  id: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
    impression_count?: number;
  };
};

export async function lookupTweets(ids: string[]): Promise<TweetLookup[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) throw new Error("lookupTweets: max 100 IDs/req");
  const url = new URL(`${X_BASE}/tweets`);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("tweet.fields", "public_metrics");
  const res = await request(url, { headers: authHeaders() });
  const body = (await res.body.json()) as { data?: TweetLookup[] };
  if (res.statusCode >= 400) {
    logger.warn({ status: res.statusCode, body }, "X tweets lookup error");
    throw new Error(`X tweets GET ${res.statusCode}`);
  }
  return body.data ?? [];
}

export async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
