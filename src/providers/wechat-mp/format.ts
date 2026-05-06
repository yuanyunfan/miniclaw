import type { WechatMpCollectResult } from "./types.js";

export function formatWechatMpCollectResult(result: WechatMpCollectResult): string {
  const compact = {
    generated_at: result.generated_at,
    window_start: result.window_start,
    window_end: result.window_end,
    window_label: result.window_label,
    total_articles: result.total_articles,
    skipped_duplicates: result.skipped_duplicates,
    accounts: result.accounts.map((account) => ({
      name: account.name,
      alias: account.alias,
      status: account.status,
      article_count: account.article_count,
      error: account.error,
      articles: account.articles.map((article) => ({
        title: article.title,
        digest: article.digest,
        published_at: article.publish_time_iso,
        link: article.link,
      })),
    })),
  };
  return JSON.stringify(compact, null, 2);
}
