/**
 * Example: Multi-HTML Pipeline
 *
 * This pipeline demonstrates scraping multiple HTML pages,
 * extracting data from each, and saving the results.
 */

import {
  ScrapeRunnerImpl,
  HtmlFetcher,
  JsonSink,
  type PipelineStep,
  type RunnerConfig,
  type PipelineModule,
  type ScrapeContext,
} from '../src/index';

const config: RunnerConfig = {
  mode: 'production',
  delay: 1000,
  maxItems: 50,
  resumeFromLog: true,
  rateLimit: {
    requests: 5,
    perMilliseconds: 2000,
  },
  retry: {
    attempts: 3,
    backoffStrategy: 'exponential',
    baseDelay: 500,
  },
  telemetry: {
    enabled: true,
    logLevel: 'info',
  },
};

const htmlFetcher = new HtmlFetcher({
  axios: {
    timeout: 15000,
    headers: {
      'User-Agent': 'ScraparExample/1.0',
    },
  },
  retry: {
    retries: 2,
    minTimeout: 500,
    maxTimeout: 2000,
  },
  rateLimit: {
    requests: 5,
    perMilliseconds: 2000,
  },
});

const jsonSink = new JsonSink({
  outputDir: './data',
  fileName: 'scraped-pages',
  calculateItemCount: true,
  successMessage: 'Pages saved',
});

const steps: PipelineStep<ScrapeContext>[] = [
  {
    id: 'fetch-page-list',
    label: 'Fetch Page List',
    description: 'Get list of pages to scrape',
    dependencies: [],
    async run(context) {
      // Example: Fetch a page that contains links to other pages
      const listPage = await htmlFetcher.fetch(
        {
          url: 'https://example.com/sitemap',
        },
        context,
      );

      const links: string[] = [];
      listPage.$('a[href]').each((_, element) => {
        const href = listPage.$(element).attr('href');
        if (href && href.startsWith('http')) {
          links.push(href);
        }
      });

      context.data.pageUrls = links.slice(0, context.config.maxItems ?? 50);
      console.log(`Found ${context.data.pageUrls.length} pages to scrape`);
    },
  },
  {
    id: 'scrape-pages',
    label: 'Scrape Individual Pages',
    description: 'Fetch and extract data from each page',
    dependencies: ['fetch-page-list'],
    async run(context) {
      const urls = context.data.pageUrls as string[];
      const results: Array<{
        url: string;
        title: string;
        headings: string[];
        links: number;
      }> = [];

      for (const url of urls) {
        try {
          const response = await htmlFetcher.fetch({ url }, context);

          const title = response.$('title').text().trim();
          const headings: string[] = [];
          response.$('h1, h2, h3').each((_, element) => {
            const text = response.$(element).text().trim();
            if (text) {
              headings.push(text);
            }
          });
          const linkCount = response.$('a[href]').length;

          results.push({
            url: response.url,
            title,
            headings,
            links: linkCount,
          });

          console.log(`Scraped: ${url}`);
        } catch (error) {
          console.error(`Failed to scrape ${url}:`, error);
        }
      }

      context.data.scrapedPages = results;
      console.log(`Successfully scraped ${results.length} pages`);
    },
  },
  {
    id: 'save-results',
    label: 'Save Results',
    description: 'Persist scraped data to JSON file',
    dependencies: ['scrape-pages'],
    async run(context) {
      const pages = context.data.scrapedPages;
      if (!pages || (Array.isArray(pages) && pages.length === 0)) {
        console.warn('No pages to save');
        return;
      }

      await jsonSink.write(pages, context);
    },
  },
];

export const pipeline: PipelineModule = {
  config,
  steps,
};

// For programmatic usage:
// const runner = new ScrapeRunnerImpl(config);
// runner.setSteps(steps);
// await runner.run();

