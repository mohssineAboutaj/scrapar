/**
 * Core type definitions that describe the Scrapar framework contracts.
 *
 * The configuration schema is centered around {@link RunnerConfig}, which is
 * designed to be serialisable (e.g. JSON/YAML) and supports the following keys:
 *
 * ```jsonc
 * {
 *   "mode": "development",             // or "production"
 *   "delay": 250,                     // delay (ms) applied between iterations
 *   "maxItems": 100,                  // optional safety cap for processed items
 *   "resumeFromLog": true,            // enable resume capability
 *   "rateLimit": {                    // optional rate limit shared by fetchers
 *     "requests": 10,
 *     "perMilliseconds": 1000
 *   },
 *   "retry": {                        // default retry policy for steps/fetchers
 *     "attempts": 3,
 *     "backoffStrategy": "exponential",
 *     "baseDelay": 250
 *   },
 *   "telemetry": {
 *     "enabled": true,
 *     "logLevel": "info"              // "silent" | "info" | "debug"
 *   }
 * }
 * ```
 */

/**
 * Configuration accepted by the runner and propagated to the execution context.
 */
export interface RunnerConfig {
  mode: 'development' | 'production';
  delay: number;
  maxItems?: number;
  resumeFromLog?: boolean;
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

/**
 * Shared data container that every pipeline step receives.
 */
export interface ScrapeContext<
  Shared extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly runId: string;
  readonly startedAt: Date;
  readonly config: RunnerConfig;
  data: Shared;
  readonly stepState: Map<string, unknown>;
  readonly metadata: Map<string, unknown>;
  getStepState<T>(stepId: string): T | undefined;
  setStepState<T>(stepId: string, value: T): void;
}

/**
 * Event emitted around step execution lifecycle.
 */
export interface StepLifecycleEvent<TContext extends ScrapeContext = ScrapeContext> {
  step: PipelineStep<TContext>;
  context: TContext;
  stepIndex: number;
  totalSteps: number;
  startedAt: Date;
}

/**
 * Event emitted when step execution fails.
 */
export interface StepErrorEvent<TContext extends ScrapeContext = ScrapeContext>
  extends StepLifecycleEvent<TContext> {
  error: unknown;
  attempt: number;
  willRetry: boolean;
}

export type StepLifecycleHook<TContext extends ScrapeContext = ScrapeContext> = (
  event: StepLifecycleEvent<TContext>,
) => void | Promise<void>;

export type StepErrorHook<TContext extends ScrapeContext = ScrapeContext> = (
  event: StepErrorEvent<TContext>,
) => void | Promise<void>;

/**
 * Per-step retry configuration overriding the runner defaults.
 */
export interface StepRetryPolicy {
  attempts: number;
  delay: number;
  backoffStrategy: 'none' | 'linear' | 'exponential';
}

/**
 * Definition for a single unit in the scraping pipeline.
 */
export interface PipelineStep<TContext extends ScrapeContext = ScrapeContext> {
  id: string;
  label?: string;
  description?: string;
  dependencies?: string[];
  retry?: StepRetryPolicy;
  run(context: TContext): Promise<void> | void;
  beforeStep?: StepLifecycleHook<TContext>;
  afterStep?: StepLifecycleHook<TContext>;
  onError?: StepErrorHook<TContext>;
}

/**
 * Serializable snapshot of runner progress used for resume flows.
 */
export interface RunnerState {
  currentStepId: string;
  stepIndex: number;
  completedStepIds: string[];
  failedStepIds: string[];
  payload?: Record<string, unknown>;
}

export interface RunOptions {
  mode?: RunnerConfig['mode'];
  maxItems?: number;
  delay?: number;
  startStepId?: string;
  resumeState?: RunnerState;
}

export interface RunResult {
  totalSteps: number;
  completedSteps: string[];
  failedSteps: string[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/**
 * Contract for the orchestrator responsible for executing pipeline steps.
 */
export interface ScrapeRunner<TContext extends ScrapeContext = ScrapeContext> {
  readonly config: RunnerConfig;
  readonly steps: readonly PipelineStep<TContext>[];
  registerStep(step: PipelineStep<TContext>): this;
  setSteps(steps: PipelineStep<TContext>[]): this;
  run(options?: RunOptions): Promise<RunResult>;
  resume(state: RunnerState, options?: RunOptions): Promise<RunResult>;
  getContext(): TContext;
}

/**
 * Fetcher abstraction used by steps to retrieve external data.
 */
export interface Fetcher<
  RequestInput = unknown,
  ResponseOutput = unknown,
  TContext extends ScrapeContext = ScrapeContext,
> {
  readonly id: string;
  fetch(input: RequestInput, context: TContext): Promise<ResponseOutput>;
  afterFetch?(
    response: ResponseOutput,
    context: TContext,
    input: RequestInput,
  ): Promise<void> | void;
  onError?(error: unknown, context: TContext, input: RequestInput): Promise<void> | void;
}

/**
 * Persistence abstraction for storing outputs (e.g. JSON file, database, etc).
 */
export interface Sink<Payload = unknown, TContext extends ScrapeContext = ScrapeContext> {
  readonly id: string;
  write(payload: Payload, context: TContext): Promise<void>;
  flush?(context: TContext): Promise<void>;
}

/**
 * Collection of lifecycle hooks that a runner can be configured with.
 */
export interface RunnerLifecycle<TContext extends ScrapeContext = ScrapeContext> {
  beforeStep?: StepLifecycleHook<TContext>;
  afterStep?: StepLifecycleHook<TContext>;
  onError?: StepErrorHook<TContext>;
}

export interface RunnerOptions<TContext extends ScrapeContext = ScrapeContext> {
  config: RunnerConfig;
  lifecycle?: RunnerLifecycle<TContext>;
  steps?: PipelineStep<TContext>[];
}

export type {
  ScrapeContext as IScrapeContext,
  PipelineStep as IPipelineStep,
  ScrapeRunner as IScrapeRunner,
  Fetcher as IFetcher,
  Sink as ISink,
};

