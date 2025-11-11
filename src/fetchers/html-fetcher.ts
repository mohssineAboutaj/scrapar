import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { load, CheerioAPI } from 'cheerio';
import pRetry, { AbortError, Options as RetryOptions } from 'p-retry';
import { Fetcher, ScrapeContext } from '../types';

export interface HtmlFetcherRequest {
  url: string;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  retry?: RetryOptions;
  signal?: AbortSignal;
}

export interface HtmlFetcherResponse {
  url: string;
  status: number;
  headers: Record<string, unknown>;
  html: string;
  $: CheerioAPI;
  response: AxiosResponse<string>;
}

export interface HtmlFetcherOptions {
  axios?: AxiosRequestConfig;
  retry?: RetryOptions;
  rateLimit?: {
    requests: number;
    perMilliseconds: number;
  };
  minDelayMs?: number;
  onBeforeRequest?<TContext extends ScrapeContext>(
    request: HtmlFetcherRequest,
    config: AxiosRequestConfig,
    context: TContext,
  ): Promise<void> | void;
  onAfterResponse?<TContext extends ScrapeContext>(
    response: HtmlFetcherResponse,
    context: TContext,
  ): Promise<void> | void;
}

const METADATA_LAST_REQUEST = 'html-fetcher:last-request-at';

export class HtmlFetcher<TContext extends ScrapeContext = ScrapeContext>
  implements Fetcher<HtmlFetcherRequest, HtmlFetcherResponse, TContext>
{
  public readonly id = 'html-fetcher';

  private readonly client: AxiosInstance;

  private lastRequestAt?: number;

  constructor(private readonly options: HtmlFetcherOptions = {}) {
    this.client = axios.create({
      timeout: 15_000,
      maxRedirects: 5,
      headers: {
        'user-agent':
          'ScraparBot/0.1 (+https://github.com/mohssineAboutaj/scrapar; support@scrapar.dev)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...options.axios?.headers,
      },
      ...options.axios,
    });
  }

  public async fetch(request: HtmlFetcherRequest, context: TContext): Promise<HtmlFetcherResponse> {
    await this.applyDelays(context);

    const operation = async (): Promise<HtmlFetcherResponse> => {
      const config = this.buildRequestConfig(request);

      if (this.options.onBeforeRequest) {
        await this.options.onBeforeRequest(request, config, context);
      }

      try {
        const response = await this.client.request<string>(config);
        const html = response.data;
        const cheerioRoot = load(html);
        const result: HtmlFetcherResponse = {
          url: response.config.url ?? request.url,
          status: response.status,
          headers: response.headers as Record<string, unknown>,
          html,
          $: cheerioRoot,
          response,
        };

        if (this.options.onAfterResponse) {
          await this.options.onAfterResponse(result, context);
        }

        return result;
      } catch (error) {
        if (this.isRetryable(error)) {
          throw error;
        }

        const reason = error instanceof Error ? error : new Error('HTML fetcher aborted');
        throw new AbortError(reason);
      } finally {
        this.markRequest(context);
      }
    };

    const retryOptions: RetryOptions = {
      retries: 2,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 2_000,
      ...this.options.retry,
      ...request.retry,
    };

    return await pRetry(operation, retryOptions);
  }

  private buildRequestConfig(request: HtmlFetcherRequest): AxiosRequestConfig {
    return {
      responseType: 'text',
      method: request.method ?? 'GET',
      url: request.url,
      headers: {
        ...this.options.axios?.headers,
        ...request.headers,
      },
      params: request.params,
      signal: request.signal,
    };
  }

  private isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    if (status && status >= 400 && status < 500 && status !== 429) {
      return false;
    }

    return true;
  }

  private async applyDelays(context: TContext): Promise<void> {
    const rate = this.options.rateLimit ?? context.config.rateLimit;
    const now = Date.now();
    const last =
      this.lastRequestAt ?? (context.metadata.get(METADATA_LAST_REQUEST) as number | undefined);

    if (rate) {
      const interval = Math.ceil(rate.perMilliseconds / rate.requests);
      const diff = typeof last === 'number' ? now - last : Number.POSITIVE_INFINITY;
      if (diff < interval) {
        await this.delay(interval - diff);
      }
    }

    if (this.options.minDelayMs && this.options.minDelayMs > 0) {
      const diff = typeof last === 'number' ? now - last : Number.POSITIVE_INFINITY;
      if (diff < this.options.minDelayMs) {
        await this.delay(this.options.minDelayMs - diff);
      }
    }
  }

  private markRequest(context: TContext): void {
    const now = Date.now();
    this.lastRequestAt = now;
    context.metadata.set(METADATA_LAST_REQUEST, now);
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export default HtmlFetcher;

