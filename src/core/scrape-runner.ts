import {
  ScrapeContext,
  PipelineStep,
  ScrapeRunner,
  RunnerConfig,
  RunOptions,
  RunResult,
  RunnerState,
  StepLifecycleEvent,
  StepErrorEvent,
  RunnerLifecycle,
} from '../types';

export class ScrapeContextImpl<Shared extends Record<string, unknown> = Record<string, unknown>>
  implements ScrapeContext<Shared>
{
  public readonly runId: string;
  public readonly startedAt: Date;
  public readonly config: RunnerConfig;
  public data: Shared;
  public readonly stepState: Map<string, unknown>;
  public readonly metadata: Map<string, unknown>;

  constructor(config: RunnerConfig, runId?: string) {
    this.runId = runId ?? `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.startedAt = new Date();
    this.config = config;
    this.data = {} as Shared;
    this.stepState = new Map();
    this.metadata = new Map();
  }

  public getStepState<T>(stepId: string): T | undefined {
    return this.stepState.get(stepId) as T | undefined;
  }

  public setStepState<T>(stepId: string, value: T): void {
    this.stepState.set(stepId, value);
  }
}

export class ScrapeRunnerImpl<TContext extends ScrapeContext = ScrapeContext>
  implements ScrapeRunner<TContext>
{
  public readonly config: RunnerConfig;
  private _steps: PipelineStep<TContext>[] = [];
  private readonly lifecycle?: RunnerLifecycle<TContext>;

  constructor(config: RunnerConfig, lifecycle?: RunnerLifecycle<TContext>) {
    this.config = config;
    this.lifecycle = lifecycle;
  }

  public get steps(): readonly PipelineStep<TContext>[] {
    return [...this._steps];
  }

  public registerStep(step: PipelineStep<TContext>): this {
    this._steps.push(step);
    return this;
  }

  public setSteps(steps: PipelineStep<TContext>[]): this {
    this._steps = [...steps];
    return this;
  }

  public getContext(): TContext {
    return new ScrapeContextImpl(this.config) as TContext;
  }

  public async run(options: RunOptions = {}): Promise<RunResult> {
    const mergedConfig: RunnerConfig = {
      ...this.config,
      mode: options.mode ?? this.config.mode,
      delay: options.delay ?? this.config.delay,
      maxItems: options.maxItems ?? this.config.maxItems,
    };

    const context = new ScrapeContextImpl(mergedConfig) as TContext;
    const startedAt = new Date();

    const orderedSteps = this.resolveDependencies(this._steps);
    const startIndex = options.startStepId
      ? orderedSteps.findIndex((s) => s.id === options.startStepId)
      : 0;

    if (startIndex < 0) {
      throw new Error(`Step with id "${options.startStepId}" not found`);
    }

    const stepsToRun = orderedSteps.slice(startIndex);
    const completedSteps: string[] = [];
    const failedSteps: string[] = [];

    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i];
      const stepIndex = startIndex + i;
      const totalSteps = orderedSteps.length;

      try {
        await this.executeStep(step, context, stepIndex, totalSteps);
        completedSteps.push(step.id);
      } catch (error) {
        failedSteps.push(step.id);
        const errorEvent: StepErrorEvent<TContext> = {
          step,
          context,
          stepIndex,
          totalSteps,
          startedAt: new Date(),
          error,
          attempt: 1,
          willRetry: false,
        };

        if (this.lifecycle?.onError) {
          await this.lifecycle.onError(errorEvent);
        }

        if (step.onError) {
          await step.onError(errorEvent);
        }

        throw error;
      }
    }

    const finishedAt = new Date();
    return {
      totalSteps: orderedSteps.length,
      completedSteps,
      failedSteps,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  public async resume(state: RunnerState, options: RunOptions = {}): Promise<RunResult> {
    const mergedConfig: RunnerConfig = {
      ...this.config,
      mode: options.mode ?? this.config.mode,
      delay: options.delay ?? this.config.delay,
      maxItems: options.maxItems ?? this.config.maxItems,
    };

    const context = new ScrapeContextImpl(mergedConfig) as TContext;
    if (state.payload) {
      context.data = { ...context.data, ...state.payload } as typeof context.data;
    }

    const startedAt = new Date();
    const orderedSteps = this.resolveDependencies(this._steps);
    const startIndex = state.stepIndex;

    if (startIndex < 0 || startIndex >= orderedSteps.length) {
      throw new Error(`Invalid step index: ${startIndex}`);
    }

    const stepsToRun = orderedSteps.slice(startIndex);
    const completedSteps: string[] = [...state.completedStepIds];
    const failedSteps: string[] = [...state.failedStepIds];

    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i];
      const stepIndex = startIndex + i;
      const totalSteps = orderedSteps.length;

      try {
        await this.executeStep(step, context, stepIndex, totalSteps);
        completedSteps.push(step.id);
      } catch (error) {
        failedSteps.push(step.id);
        const errorEvent: StepErrorEvent<TContext> = {
          step,
          context,
          stepIndex,
          totalSteps,
          startedAt: new Date(),
          error,
          attempt: 1,
          willRetry: false,
        };

        if (this.lifecycle?.onError) {
          await this.lifecycle.onError(errorEvent);
        }

        if (step.onError) {
          await step.onError(errorEvent);
        }

        throw error;
      }
    }

    const finishedAt = new Date();
    return {
      totalSteps: orderedSteps.length,
      completedSteps,
      failedSteps,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  private async executeStep(
    step: PipelineStep<TContext>,
    context: TContext,
    stepIndex: number,
    totalSteps: number,
  ): Promise<void> {
    const lifecycleEvent: StepLifecycleEvent<TContext> = {
      step,
      context,
      stepIndex,
      totalSteps,
      startedAt: new Date(),
    };

    if (this.lifecycle?.beforeStep) {
      await this.lifecycle.beforeStep(lifecycleEvent);
    }

    if (step.beforeStep) {
      await step.beforeStep(lifecycleEvent);
    }

    try {
      await step.run(context);
    } catch (error) {
      const errorEvent: StepErrorEvent<TContext> = {
        ...lifecycleEvent,
        error,
        attempt: 1,
        willRetry: false,
      };

      if (this.lifecycle?.onError) {
        await this.lifecycle.onError(errorEvent);
      }

      if (step.onError) {
        await step.onError(errorEvent);
      }

      throw error;
    }

    if (this.lifecycle?.afterStep) {
      await this.lifecycle.afterStep(lifecycleEvent);
    }

    if (step.afterStep) {
      await step.afterStep(lifecycleEvent);
    }
  }

  private resolveDependencies(steps: PipelineStep<TContext>[]): PipelineStep<TContext>[] {
    const stepMap = new Map<string, PipelineStep<TContext>>();
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      graph.set(step.id, []);
    }

    for (const step of steps) {
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          if (!stepMap.has(depId)) {
            throw new Error(`Dependency "${depId}" not found for step "${step.id}"`);
          }
          graph.get(depId)?.push(step.id);
          inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [stepId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(stepId);
      }
    }

    const result: PipelineStep<TContext>[] = [];

    while (queue.length > 0) {
      const stepId = queue.shift()!;
      const step = stepMap.get(stepId);
      if (step) {
        result.push(step);
      }

      const dependents = graph.get(stepId) ?? [];
      for (const dependentId of dependents) {
        const currentDegree = inDegree.get(dependentId) ?? 0;
        inDegree.set(dependentId, currentDegree - 1);
        if (currentDegree - 1 === 0) {
          queue.push(dependentId);
        }
      }
    }

    if (result.length !== steps.length) {
      const missing = steps.filter((s) => !result.some((r) => r.id === s.id));
      throw new Error(
        `Circular dependency detected or missing steps: ${missing.map((s) => s.id).join(', ')}`,
      );
    }

    return result;
  }
}

export default ScrapeRunnerImpl;

