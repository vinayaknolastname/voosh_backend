import Parser from 'rss-parser';

type NewsFeedItem = {
  title?: string;
  contentSnippet?: string;
  content?: string;
  link?: string;
  pubDate?: string;
};

export type Article = {
  title: string;
  content: string;
  link: string;
  pubDate?: string;
  source?: string;
};

const parser = new Parser<NewsFeedItem>();

const NEWS_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best',
  'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
];

export const ingestNews = async (): Promise<Article[]> => {
  let articles: Article[] = [];
  console.log('Starting news ingestion...');

  for (const feedUrl of NEWS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      console.log(`Fetched ${feed.items?.length ?? 0} articles from ${feedUrl}`);

      const feedArticles: Article[] = (feed.items ?? []).map((item) => ({
        title: item.title ?? 'Untitled',
        content: item.contentSnippet ?? item.content ?? '',
        link: item.link ?? '',
        pubDate: item.pubDate,
        source: feed.title,
      }));

      articles = [...articles, ...feedArticles];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error fetching feed ${feedUrl}:`, message);
    }
  }

  // Limit to ~50 articles as per requirement
  return articles.slice(0, 50);
};

export default ingestNews;

