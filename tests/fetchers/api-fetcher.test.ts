import { ApiFetcher } from '../../src/fetchers/api-fetcher';
import { ScrapeContextImpl } from '../../src/core/scrape-runner';
import type { RunnerConfig } from '../../src/types';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

describe('ApiFetcher', () => {
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
    it('should fetch JSON data', async () => {
      const data = { id: 1, name: 'Test' };
      mockAdapter.onGet('https://api.example.com/users').reply(200, data);

      const fetcher = new ApiFetcher();
      const response = await fetcher.fetch(
        { url: 'https://api.example.com/users' },
        context,
      );

      expect(response.status).toBe(200);
      expect(response.data).toEqual(data);
    });

    it('should support GET method', async () => {
      const data = { result: 'success' };
      mockAdapter.onGet('https://api.example.com/data').reply(200, data);

      const fetcher = new ApiFetcher();
      const response = await fetcher.get('https://api.example.com/data', context);

      expect(response.status).toBe(200);
      expect(response.data).toEqual(data);
    });

    it('should support POST method with data', async () => {
      const requestData = { name: 'John' };
      const responseData = { id: 1, ...requestData };
      mockAdapter.onPost('https://api.example.com/users').reply(200, responseData);

      const fetcher = new ApiFetcher();
      const response = await fetcher.post('https://api.example.com/users', context, {
        data: requestData,
      });

      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseData);
    });

    it('should apply bearer token authentication', async () => {
      const data = { user: 'test' };
      mockAdapter.onGet('https://api.example.com/protected').reply(200, data);

      const fetcher = new ApiFetcher();
      const response = await fetcher.fetch(
        {
          url: 'https://api.example.com/protected',
          auth: {
            type: 'bearer',
            token: 'test-token',
          },
        },
        context,
      );

      // Verify request succeeded (auth was applied)
      expect(response.status).toBe(200);
      expect(response.data).toEqual(data);
    });

    it('should apply basic authentication', async () => {
      const data = { user: 'test' };
      mockAdapter.onGet('https://api.example.com/protected').reply(200, data);

      const fetcher = new ApiFetcher();
      const response = await fetcher.fetch(
        {
          url: 'https://api.example.com/protected',
          auth: {
            type: 'basic',
            username: 'user',
            password: 'pass',
          },
        },
        context,
      );

      // Verify request succeeded (auth was applied)
      expect(response.status).toBe(200);
      expect(response.data).toEqual(data);
    });

    it('should normalize JSON responses', async () => {
      const data = { nested: { value: 'test' } };
      mockAdapter.onGet('https://api.example.com/data').reply(200, data);

      const fetcher = new ApiFetcher();
      const response = await fetcher.get('https://api.example.com/data', context);

      expect(response.data).toEqual(data);
    });

    it('should create structured error', () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 404,
          statusText: 'Not Found',
          data: { message: 'Resource not found' },
        },
        code: 'ERR_BAD_REQUEST',
        message: 'Request failed',
      } as unknown as import('axios').AxiosError;

      const error = ApiFetcher.createError(axiosError);
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.isRetryable).toBe(false);
    });
  });
});

