import { HtmlFetcher } from '../../src/fetchers/html-fetcher';
import { ScrapeContextImpl } from '../../src/core/scrape-runner';
import type { RunnerConfig } from '../../src/types';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

describe('HtmlFetcher', () => {
  let mockAdapter: MockAdapter;
  let config: RunnerConfig;
  let context: ScrapeContextImpl;

  beforeEach(() => {
    mockAdapter = new MockAdapter(axios);
    config = {
      mode: 'development',
      delay: 100,
    };
    context = new ScrapeContextImpl(config);
  });

  afterEach(() => {
    mockAdapter.restore();
  });

  describe('fetch', () => {
    it('should fetch HTML and parse with Cheerio', async () => {
      const html = '<html><head><title>Test Page</title></head><body><h1>Hello</h1></body></html>';
      mockAdapter.onGet('https://example.com').reply(200, html);

      const fetcher = new HtmlFetcher();
      const response = await fetcher.fetch({ url: 'https://example.com' }, context);

      expect(response.status).toBe(200);
      expect(response.html).toBe(html);
      expect(response.$('title').text()).toBe('Test Page');
      expect(response.$('h1').text()).toBe('Hello');
    });

    it('should apply custom headers', async () => {
      const html = '<html><body>Test</body></html>';
      mockAdapter.onGet('https://example.com').reply((config) => {
        expect(config.headers?.['X-Custom-Header']).toBe('custom-value');
        return [200, html];
      });

      const fetcher = new HtmlFetcher();
      await fetcher.fetch(
        {
          url: 'https://example.com',
          headers: { 'X-Custom-Header': 'custom-value' },
        },
        context,
      );
    });

    it('should retry on failure', async () => {
      mockAdapter.onGet('https://example.com').replyOnce(500);
      mockAdapter.onGet('https://example.com').replyOnce(500);
      mockAdapter.onGet('https://example.com').reply(200, '<html><body>Success</body></html>');

      const fetcher = new HtmlFetcher({
        retry: {
          retries: 2,
          minTimeout: 10,
          maxTimeout: 50,
        },
      });

      const response = await fetcher.fetch({ url: 'https://example.com' }, context);
      expect(response.status).toBe(200);
    });

    it('should respect rate limiting', async () => {
      const html = '<html><body>Test</body></html>';
      mockAdapter.onGet('https://example.com').reply(200, html);

      const fetcher = new HtmlFetcher({
        rateLimit: {
          requests: 1,
          perMilliseconds: 100,
        },
      });

      const start = Date.now();
      await fetcher.fetch({ url: 'https://example.com' }, context);
      await fetcher.fetch({ url: 'https://example.com' }, context);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(90);
    });
  });
});

