function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing required env: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  supabaseUrl: req("SUPABASE_URL"),
  supabaseServiceKey: req("SUPABASE_SERVICE_ROLE_KEY"),
  xBearerToken: req("X_BEARER_TOKEN"),
  opsSecret: req("WORKER_OPS_SECRET"),
  port: num("PORT", 8080),
  logLevel: process.env.LOG_LEVEL || "info",
  resampleLoopIntervalMs: num("RESAMPLE_LOOP_INTERVAL_MS", 60_000),
  ruleResyncIntervalMs: num("RULE_RESYNC_INTERVAL_MS", 300_000),
  heartbeatIntervalMs: num("HEARTBEAT_INTERVAL_MS", 30_000),
  tweetLookupThrottleMs: num("TWEET_LOOKUP_THROTTLE_MS", 1200),
  resampleBatchSize: num("RESAMPLE_BATCH_SIZE", 100),
} as const;
