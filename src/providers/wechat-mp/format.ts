import type { WechatMpCollectResult } from "./types.js";

export function formatWechatMpCollectResult(result: WechatMpCollectResult): string {
  const allArticles = result.accounts.flatMap((account) => account.articles.map((article) => ({
    account: account.name,
    account_alias: account.alias,
    title: article.title,
    digest: article.digest,
    published_at: article.publish_time_iso,
    link: article.link,
    title_screen: article.title_screen,
    content_fetch: article.content_fetch,
  })));
  const fullReadArticles = allArticles
    .filter((article) => article.content_fetch?.status && article.content_fetch.status !== "not_attempted")
    .sort((a, b) => (b.title_screen?.score ?? 0) - (a.title_screen?.score ?? 0));
  const compact = {
    generated_at: result.generated_at,
    window_start: result.window_start,
    window_end: result.window_end,
    window_label: result.window_label,
    total_articles: result.total_articles,
    skipped_duplicates: result.skipped_duplicates,
    read_filter: result.read_filter
      ? {
          ...result.read_filter,
          full_read_articles: fullReadArticles,
        }
      : undefined,
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
        title_screen: article.title_screen,
      })),
    })),
  };
  return JSON.stringify(compact, null, 2);
}
