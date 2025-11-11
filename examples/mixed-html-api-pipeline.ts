/**
 * Example: Mixed HTML/API Pipeline
 *
 * This pipeline demonstrates combining HTML scraping with API calls,
 * showing how to use both fetchers in a single workflow.
 */

import {
  ScrapeRunnerImpl,
  HtmlFetcher,
  ApiFetcher,
  JsonSink,
  type PipelineStep,
  type RunnerConfig,
  type PipelineModule,
  type ScrapeContext,
} from '../src/index';

const config: RunnerConfig = {
  mode: 'production',
  delay: 500,
  maxItems: 100,
  resumeFromLog: true,
  rateLimit: {
    requests: 10,
    perMilliseconds: 1000,
  },
  retry: {
    attempts: 3,
    backoffStrategy: 'exponential',
    baseDelay: 250,
  },
  telemetry: {
    enabled: true,
    logLevel: 'info',
  },
};

const htmlFetcher = new HtmlFetcher({
  axios: {
    timeout: 10000,
  },
  rateLimit: {
    requests: 5,
    perMilliseconds: 2000,
  },
});

const apiFetcher = new ApiFetcher({
  axios: {
    baseURL: 'https://api.example.com',
    timeout: 10000,
  },
  retry: {
    retries: 2,
    minTimeout: 500,
    maxTimeout: 2000,
  },
});

const jsonSink = new JsonSink({
  outputDir: './data',
  fileName: 'combined-results',
  calculateItemCount: true,
  successMessage: 'Combined data saved',
});

const steps: PipelineStep<ScrapeContext>[] = [
  {
    id: 'fetch-product-list',
    label: 'Fetch Product List from HTML',
    description: 'Scrape product listing page',
    dependencies: [],
    async run(context) {
      const response = await htmlFetcher.fetch(
        {
          url: 'https://example.com/products',
        },
        context,
      );

      const productIds: string[] = [];
      response.$('.product-item[data-id]').each((_, element) => {
        const id = response.$(element).attr('data-id');
        if (id) {
          productIds.push(id);
        }
      });

      context.data.productIds = productIds;
      console.log(`Found ${productIds.length} products`);
    },
  },
  {
    id: 'fetch-product-details',
    label: 'Fetch Product Details from API',
    description: 'Get detailed information for each product via API',
    dependencies: ['fetch-product-list'],
    async run(context) {
      const productIds = context.data.productIds as string[];
      const products: Array<{
        id: string;
        name: string;
        price: number;
        description: string;
        stock: number;
      }> = [];

      for (const productId of productIds.slice(0, context.config.maxItems ?? 100)) {
        try {
          const response = await apiFetcher.get<{
            id: string;
            name: string;
            price: number;
            description: string;
            stock: number;
          }>(
            `/products/${productId}`,
            context,
            {
              auth: {
                type: 'bearer',
                token: process.env.API_TOKEN || 'your-token-here',
              },
            },
          );

          products.push(response.data);
          console.log(`Fetched details for product: ${productId}`);
        } catch (error) {
          console.error(`Failed to fetch product ${productId}:`, error);
        }
      }

      context.data.products = products;
      console.log(`Fetched details for ${products.length} products`);
    },
  },
  {
    id: 'enrich-with-reviews',
    label: 'Enrich with Reviews from HTML',
    description: 'Scrape review pages for each product',
    dependencies: ['fetch-product-details'],
    async run(context) {
      const products = context.data.products as Array<{ id: string; name: string }>;
      const enrichedProducts: Array<{
        id: string;
        name: string;
        reviews: Array<{ author: string; rating: number; text: string }>;
      }> = [];

      for (const product of products.slice(0, 10)) {
        try {
          const response = await htmlFetcher.fetch(
            {
              url: `https://example.com/products/${product.id}/reviews`,
            },
            context,
          );

          const reviews: Array<{ author: string; rating: number; text: string }> = [];
          response.$('.review-item').each((_, element) => {
            const author = response.$(element).find('.review-author').text().trim();
            const ratingText = response.$(element).find('.review-rating').text().trim();
            const rating = Number.parseInt(ratingText, 10) || 0;
            const text = response.$(element).find('.review-text').text().trim();

            if (author && text) {
              reviews.push({ author, rating, text });
            }
          });

          enrichedProducts.push({
            id: product.id,
            name: product.name,
            reviews,
          });

          console.log(`Enriched product ${product.id} with ${reviews.length} reviews`);
        } catch (error) {
          console.error(`Failed to enrich product ${product.id}:`, error);
        }
      }

      context.data.enrichedProducts = enrichedProducts;
    },
  },
  {
    id: 'post-analytics',
    label: 'Post Analytics to API',
    description: 'Send aggregated data to analytics API',
    dependencies: ['enrich-with-reviews'],
    async run(context) {
      const enrichedProducts = context.data.enrichedProducts as Array<{
        id: string;
        reviews: Array<{ rating: number }>;
      }>;

      const analytics = {
        totalProducts: enrichedProducts.length,
        totalReviews: enrichedProducts.reduce(
          (sum, p) => sum + p.reviews.length,
          0,
        ),
        averageRating:
          enrichedProducts.reduce((sum, p) => {
            const avg =
              p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length || 0;
            return sum + avg;
          }, 0) / enrichedProducts.length || 0,
      };

      try {
        await apiFetcher.post(
          '/analytics',
          context,
          {
            data: analytics,
            auth: {
              type: 'bearer',
              token: process.env.API_TOKEN || 'your-token-here',
            },
          },
        );

        console.log('Analytics posted successfully:', analytics);
      } catch (error) {
        console.error('Failed to post analytics:', error);
      }
    },
  },
  {
    id: 'save-final-results',
    label: 'Save Final Results',
    description: 'Persist enriched product data',
    dependencies: ['post-analytics'],
    async run(context) {
      const enrichedProducts = context.data.enrichedProducts;
      if (!enrichedProducts || (Array.isArray(enrichedProducts) && enrichedProducts.length === 0)) {
        console.warn('No enriched products to save');
        return;
      }

      await jsonSink.write(enrichedProducts, context);
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

