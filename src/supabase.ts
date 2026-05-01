import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type RuntimeConfig = {
  enabled: boolean;
  hard_cap_charges_month: number;
  absolute_ceiling_charges: number;
  cap_unlocked: boolean;
  kill_switch_tripped: boolean;
  current_month_charges_count: number;
  month_reset_at: string | null;
};

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const { data, error } = await supabase.rpc("worker_puls_get_runtime_config");
  if (error) throw error;
  return data as RuntimeConfig;
}

export type ActiveHandles = {
  handles: Array<{ id: string; handle: string }>;
  rule_set_hash: string;
  count: number;
};

export async function getActiveHandles(): Promise<ActiveHandles> {
  const { data, error } = await supabase.rpc("worker_puls_get_active_handles");
  if (error) throw error;
  return data as ActiveHandles;
}

export async function heartbeat(
  streamStatus: "connected" | "reconnecting" | "down" | "paused",
  lastError: string | null,
  ruleSetHash: string | null,
) {
  const { data, error } = await supabase.rpc("worker_puls_heartbeat", {
    p_stream_status: streamStatus,
    p_last_error: lastError,
    p_rule_set_hash: ruleSetHash,
  });
  if (error) throw error;
  return data as { ok: true; kill_switch_tripped: boolean; current_month_charges_count: number };
}

export type InitialMetrics = {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  impression_count?: number | null;
};

export async function upsertTrackedPost(
  postId: string,
  insiderId: string,
  authorHandle: string,
  postedAt: string,
  initialMetrics?: InitialMetrics,
) {
  const { data, error } = await supabase.rpc("worker_puls_upsert_tracked_post", {
    p_post_id: postId,
    p_insider_id: insiderId,
    p_author_handle: authorHandle,
    p_posted_at: postedAt,
    p_initial_metrics: initialMetrics ?? null,
  });
  if (error) throw error;
  return data as { ok: true; is_new_post: boolean; charged: boolean };
}

export async function insertMetricsBatch(samples: Array<{
  post_id: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  impression_count?: number | null;
}>) {
  if (samples.length === 0) return { ok: true, inserted: 0, extra_charges: 0 };
  const { data, error } = await supabase.rpc("worker_puls_insert_metrics_batch", {
    p_samples: samples,
  });
  if (error) throw error;
  return data as { ok: true; inserted: number; extra_charges: number };
}

export type ResamplePost = {
  post_id: string;
  insider_id: string;
  author_handle: string;
  posted_at: string;
  last_sampled_at: string | null;
};

export async function getPostsToResample(limit: number): Promise<ResamplePost[]> {
  const { data, error } = await supabase.rpc("worker_puls_get_posts_to_resample", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ResamplePost[];
}
