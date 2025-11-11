import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import pRetry, { AbortError, Options as RetryOptions } from 'p-retry';
import { Fetcher, ScrapeContext } from '../types';

export interface ApiFetcherRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
  auth?: {
    type: 'bearer' | 'basic' | 'custom';
    token?: string;
    username?: string;
    password?: string;
    header?: string;
    value?: string;
  };
  retry?: RetryOptions;
  signal?: AbortSignal;
}

export interface ApiFetcherResponse<T = unknown> {
  url: string;
  status: number;
  headers: Record<string, unknown>;
  data: T;
  response: AxiosResponse<T>;
}

export interface ApiFetcherError {
  message: string;
  status?: number;
  statusText?: string;
  data?: unknown;
  code?: string;
  isRetryable: boolean;
}

export interface ApiFetcherOptions {
  axios?: AxiosRequestConfig;
  retry?: RetryOptions;
  rateLimit?: {
    requests: number;
    perMilliseconds: number;
  };
  minDelayMs?: number;
  onBeforeRequest?<TContext extends ScrapeContext>(
    request: ApiFetcherRequest,
    config: AxiosRequestConfig,
    context: TContext,
  ): Promise<void> | void;
  onAfterResponse?<TContext extends ScrapeContext>(
    response: ApiFetcherResponse,
    context: TContext,
  ): Promise<void> | void;
}

const METADATA_LAST_REQUEST = 'api-fetcher:last-request-at';

export class ApiFetcher<TContext extends ScrapeContext = ScrapeContext>
  implements Fetcher<ApiFetcherRequest, ApiFetcherResponse, TContext>
{
  public readonly id = 'api-fetcher';

  private readonly client: AxiosInstance;

  private lastRequestAt?: number;

  constructor(private readonly options: ApiFetcherOptions = {}) {
    this.client = axios.create({
      timeout: 15_000,
      maxRedirects: 5,
      headers: {
        'user-agent':
          'ScraparBot/0.1 (+https://github.com/mohssineAboutaj/scrapar; support@scrapar.dev)',
        'content-type': 'application/json',
        accept: 'application/json',
        ...options.axios?.headers,
      },
      ...options.axios,
    });
  }

  public async fetch<T = unknown>(
    request: ApiFetcherRequest,
    context: TContext,
  ): Promise<ApiFetcherResponse<T>> {
    await this.applyDelays(context);

    const operation = async (): Promise<ApiFetcherResponse<T>> => {
      const config = this.buildRequestConfig(request);

      if (this.options.onBeforeRequest) {
        await this.options.onBeforeRequest(request, config, context);
      }

      try {
        const response = await this.client.request<T>(config);
        const normalizedData = this.normalizeResponse(response.data);
        const result: ApiFetcherResponse<T> = {
          url: response.config.url ?? request.url,
          status: response.status,
          headers: response.headers as Record<string, unknown>,
          data: normalizedData,
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

        const reason = error instanceof Error ? error : new Error('API fetcher aborted');
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

  public async get<T = unknown>(
    url: string,
    context: TContext,
    options?: Omit<ApiFetcherRequest, 'url' | 'method'>,
  ): Promise<ApiFetcherResponse<T>> {
    return this.fetch<T>({ ...options, url, method: 'GET' }, context);
  }

  public async post<T = unknown>(
    url: string,
    context: TContext,
    options?: Omit<ApiFetcherRequest, 'url' | 'method'>,
  ): Promise<ApiFetcherResponse<T>> {
    return this.fetch<T>({ ...options, url, method: 'POST' }, context);
  }

  private buildRequestConfig(request: ApiFetcherRequest): AxiosRequestConfig {
    const baseHeaders = this.options.axios?.headers
      ? (this.options.axios.headers as Record<string, string>)
      : {};
    const headers: Record<string, string> = {
      ...baseHeaders,
      ...request.headers,
    };

    if (request.auth) {
      this.applyAuth(headers, request.auth);
    }

    return {
      method: request.method ?? 'GET',
      url: request.url,
      headers,
      params: request.params,
      data: request.data,
      signal: request.signal,
    };
  }

  private applyAuth(headers: Record<string, string>, auth: ApiFetcherRequest['auth']): void {
    if (!auth) {
      return;
    }

    switch (auth.type) {
      case 'bearer':
        if (auth.token) {
          headers.authorization = `Bearer ${auth.token}`;
        }
        break;
      case 'basic':
        if (auth.username && auth.password) {
          const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          headers.authorization = `Basic ${credentials}`;
        }
        break;
      case 'custom':
        if (auth.header && auth.value) {
          headers[auth.header] = auth.value;
        }
        break;
    }
  }

  private normalizeResponse<T>(data: T): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as T;
      } catch {
        return data;
      }
    }

    if (typeof data === 'object') {
      return JSON.parse(JSON.stringify(data)) as T;
    }

    return data;
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

  public static createError(error: unknown): ApiFetcherError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const statusText = axiosError.response?.statusText;
      const data = axiosError.response?.data;
      const code = axiosError.code;

      return {
        message: axiosError.message || 'API request failed',
        status,
        statusText,
        data,
        code,
        isRetryable: status === undefined || status >= 500 || status === 429,
      };
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        isRetryable: false,
      };
    }

    return {
      message: 'Unknown API error',
      isRetryable: false,
    };
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

export default ApiFetcher;

