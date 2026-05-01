import { config } from "./config.js";
import { logger } from "./logger.js";
import { getPostsToResample, getRuntimeConfig, insertMetricsBatch } from "./supabase.js";
import { lookupTweets, sleep } from "./xApi.js";

export async function startResampleLoop() {
  while (true) {
    try {
      const cfg = await getRuntimeConfig();
      if (!cfg.enabled || cfg.kill_switch_tripped) {
        await sleep(config.resampleLoopIntervalMs);
        continue;
      }

      const posts = await getPostsToResample(config.resampleBatchSize);
      if (posts.length === 0) {
        await sleep(config.resampleLoopIntervalMs);
        continue;
      }

      // chunk to max 100 IDs per X lookup
      for (let i = 0; i < posts.length; i += 100) {
        const chunk = posts.slice(i, i + 100);
        const tweets = await lookupTweets(chunk.map(p => p.post_id));
        const samples = tweets
          .filter(t => t.public_metrics)
          .map(t => ({
            post_id: t.id,
            like_count: t.public_metrics!.like_count,
            retweet_count: t.public_metrics!.retweet_count,
            reply_count: t.public_metrics!.reply_count,
            quote_count: t.public_metrics!.quote_count,
            impression_count: t.public_metrics!.impression_count ?? null,
          }));
        const r = await insertMetricsBatch(samples);
        logger.info({ posts: chunk.length, inserted: r.inserted, extra: r.extra_charges }, "resample batch");
        await sleep(config.tweetLookupThrottleMs);
      }
    } catch (err) {
      logger.error({ err: String(err) }, "resample loop error");
    }
    await sleep(config.resampleLoopIntervalMs);
  }
}
