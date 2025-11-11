# Scrapar

A modular TypeScript scraping framework with fetchers, orchestration, and CLI tooling.

## Features

- **Dual Fetchers**: HTML (Cheerio) and API (JSON) fetchers with shared retry/timeout logic
- **Pipeline Orchestration**: Dependency resolution, ordered execution, and lifecycle hooks
- **Persistence**: JSON sink with configurable output and step logging for resume flows
- **CLI Tooling**: Run, resume, retry-failed, and status commands
- **TypeScript First**: Full type safety and IntelliSense support

## Installation

```bash
npm install @mohssineAboutaj/scraper
```

## Quick Start

### 1. Create a Pipeline Module

Create a TypeScript file (e.g., `my-pipeline.ts`):

```typescript
import {
  ScrapeRunnerImpl,
  HtmlFetcher,
  JsonSink,
  type PipelineStep,
  type RunnerConfig,
  type PipelineModule,
} from '@mohssineAboutaj/scraper';

const config: RunnerConfig = {
  mode: 'production',
  delay: 1000,
  maxItems: 100,
  resumeFromLog: true,
  rateLimit: {
    requests: 10,
    perMilliseconds: 1000,
  },
};

const htmlFetcher = new HtmlFetcher();
const jsonSink = new JsonSink({ outputDir: './data' });

const steps: PipelineStep[] = [
  {
    id: 'fetch-pages',
    label: 'Fetch HTML Pages',
    dependencies: [],
    async run(context) {
      const urls = ['https://example.com/page1', 'https://example.com/page2'];
      const results = [];

      for (const url of urls) {
        const response = await htmlFetcher.fetch({ url }, context);
        results.push({
          url: response.url,
          title: response.$('title').text(),
        });
      }

      context.data.pages = results;
    },
  },
  {
    id: 'save-results',
    label: 'Save Results',
    dependencies: ['fetch-pages'],
    async run(context) {
      await jsonSink.write(context.data.pages, context);
    },
  },
];

export const pipeline: PipelineModule = {
  config,
  steps,
};
```

### 2. Run the Pipeline

```bash
npx scrapar run -p my-pipeline.ts
```

## CLI Commands

### Run

Execute a pipeline from scratch:

```bash
scrapar run -p pipeline.ts [options]
```

Options:
- `-p, --pipeline <path>`: Path to pipeline module (required)
- `-m, --mode <mode>`: Execution mode (`development`|`production`, default: `development`)
- `--delay <ms>`: Override delay between iterations
- `--max-items <count>`: Override maximum items to process
- `--log-dir <path>`: Directory for step logs (default: `./logs`)

### Resume

Resume a pipeline from the latest persisted step log:

```bash
scrapar resume -p pipeline.ts --run-id <id> [options]
```

Options:
- `-p, --pipeline <path>`: Path to pipeline module (required)
- `--run-id <id>`: Run identifier to resume (required)
- `-m, --mode <mode>`: Execution mode
- `--start-step <id>`: Explicit step identifier to resume from
- `--log-dir <path>`: Directory for step logs

### Retry Failed

Retry failed items from logs:

```bash
scrapar retry-failed -p pipeline.ts --run-id <id> [options]
```

Options:
- `-p, --pipeline <path>`: Path to pipeline module (required)
- `--run-id <id>`: Run identifier (required)
- `--log-dir <path>`: Directory for step logs

### Status

Display current pipeline status and progress:

```bash
scrapar status --run-id <id> [options]
```

Options:
- `--run-id <id>`: Run identifier (required)
- `--log-dir <path>`: Directory for step logs

## Configuration

### RunnerConfig

```typescript
interface RunnerConfig {
  mode: 'development' | 'production';
  delay: number;                    // Delay (ms) between iterations
  maxItems?: number;                // Optional safety cap
  resumeFromLog?: boolean;          // Enable resume capability
  rateLimit?: {
    requests: number;
    perMilliseconds: number;
  };
  retry?: {
    attempts: number;
    backoffStrategy: 'none' | 'linear' | 'exponential';
    baseDelay: number;
  };
  telemetry?: {
    enabled: boolean;
    logLevel: 'silent' | 'info' | 'debug';
  };
}
```

## Fetchers

### HTML Fetcher

Fetch and parse HTML pages with Cheerio:

```typescript
import { HtmlFetcher } from '@mohssineAboutaj/scraper';

const fetcher = new HtmlFetcher({
  axios: {
    timeout: 10000,
    headers: { 'User-Agent': 'MyBot/1.0' },
  },
  retry: {
    retries: 3,
    minTimeout: 500,
  },
  rateLimit: {
    requests: 5,
    perMilliseconds: 1000,
  },
});

const response = await fetcher.fetch(
  { url: 'https://example.com' },
  context
);

console.log(response.$('title').text()); // Access Cheerio API
```

### API Fetcher

Make REST API calls with authentication:

```typescript
import { ApiFetcher } from '@mohssineAboutaj/scraper';

const fetcher = new ApiFetcher({
  axios: {
    baseURL: 'https://api.example.com',
  },
});

// GET request
const getResponse = await fetcher.get('/users', context);

// POST request with auth
const postResponse = await fetcher.post(
  '/data',
  context,
  {
    data: { name: 'John' },
    auth: {
      type: 'bearer',
      token: 'your-token',
    },
  }
);
```

## Sinks

### JSON Sink

Persist data to JSON files:

```typescript
import { JsonSink } from '@mohssineAboutaj/scraper';

const sink = new JsonSink({
  outputDir: './data',
  fileName: 'results',
  calculateItemCount: true,
  successMessage: 'Data saved',
});

await sink.write([{ id: 1, name: 'Item' }], context);
```

## Lifecycle Hooks

### Step Lifecycle

```typescript
const step: PipelineStep = {
  id: 'my-step',
  async run(context) {
    // Step logic
  },
  beforeStep(event) {
    console.log(`Starting step: ${event.step.id}`);
  },
  afterStep(event) {
    console.log(`Completed step: ${event.step.id}`);
  },
  onError(event) {
    console.error(`Error in step ${event.step.id}:`, event.error);
  },
};
```

### Runner Lifecycle

```typescript
import { ScrapeRunnerImpl } from '@mohssineAboutaj/scraper';

const runner = new ScrapeRunnerImpl(config, {
  beforeStep(event) {
    console.log(`[${event.stepIndex + 1}/${event.totalSteps}] ${event.step.id}`);
  },
  afterStep(event) {
    console.log(`✓ Completed: ${event.step.id}`);
  },
  onError(event) {
    console.error(`✗ Failed: ${event.step.id}`, event.error);
  },
});
```

## Extension Points

### Custom Fetcher

```typescript
import { Fetcher, ScrapeContext } from '@mohssineAboutaj/scraper';

class CustomFetcher implements Fetcher<CustomRequest, CustomResponse> {
  readonly id = 'custom-fetcher';

  async fetch(input: CustomRequest, context: ScrapeContext): Promise<CustomResponse> {
    // Your fetching logic
  }
}
```

### Custom Sink

```typescript
import { Sink, ScrapeContext } from '@mohssineAboutaj/scraper';

class DatabaseSink implements Sink<Payload> {
  readonly id = 'database-sink';

  async write(payload: Payload, context: ScrapeContext): Promise<void> {
    // Your persistence logic
  }
}
```

## Examples

See the `examples/` directory for complete pipeline examples:

- `multi-html-pipeline.ts`: Scraping multiple HTML pages
- `mixed-html-api-pipeline.ts`: Combining HTML and API fetchers

## License

MIT

