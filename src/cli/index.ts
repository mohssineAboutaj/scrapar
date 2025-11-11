#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScrapeRunnerImpl } from '../core/scrape-runner';
import {
  StepLogger,
  type StepLoggerOptions,
  type StepLogRecord,
} from '../core/step-logger';
import type {
  PipelineStep,
  RunnerConfig,
  RunnerLifecycle,
  RunResult,
} from '../types';

interface PipelineModule {
  config: RunnerConfig;
  steps: PipelineStep[];
  lifecycle?: RunnerLifecycle;
}

type PipelineExport =
  | PipelineModule
  | (() => PipelineModule | Promise<PipelineModule>)
  | ((context: PipelineExecutionContext) => PipelineModule | Promise<PipelineModule>);

interface PipelineExecutionContext {
  mode: RunnerConfig['mode'];
  runId: string;
}

interface CommonCliOptions {
  pipeline?: string;
  mode?: RunnerConfig['mode'];
  delay?: number;
  maxItems?: number;
  logDir?: string;
  runId?: string;
}

interface ResumeCliOptions extends CommonCliOptions {
  startStep?: string;
}

interface StatusCliOptions {
  logDir?: string;
  runId?: string;
}

type RetryCliOptions = CommonCliOptions;

const program = new Command();

program
  .name('scrapar')
  .description('Scrapar pipeline runner CLI')
  .version('0.1.0');

program
  .command('run')
  .description('Execute a pipeline from the beginning')
  .requiredOption('-p, --pipeline <path>', 'Path to the pipeline module')
  .option('-m, --mode <mode>', 'Execution mode (development|production)', 'development')
  .option('--delay <ms>', 'Override delay between iterations in milliseconds', parseInteger)
  .option('--max-items <count>', 'Override maximum items to process', parseInteger)
  .option('--run-id <id>', 'Custom run identifier')
  .option('--log-dir <path>', 'Directory for step logs', './logs')
  .action(async (options: CommonCliOptions) => {
    try {
      const pipelinePath = ensureStringOption('pipeline', options.pipeline);
      const logDir = options.logDir ?? './logs';
      const mode = ensureMode(options.mode ?? 'development');
      const runId = options.runId ?? `${mode}-${Date.now()}`;
      const pipeline = await loadPipelineModule(pipelinePath, { mode, runId });

      const runnerConfig = overrideConfig(pipeline.config, {
        mode,
        delay: options.delay,
        maxItems: options.maxItems,
      });

      const stepLogger = createStepLogger({
        logDir,
        runId,
        isProduction: mode === 'production',
      });

      const lifecycle = composeLifecycle(stepLogger, pipeline.lifecycle);

      const runner = new ScrapeRunnerImpl(runnerConfig, lifecycle);
      runner.setSteps(pipeline.steps);

      console.log(`Starting run with ID: ${runId}`);
      const result = await runner.run({
        mode,
        delay: runnerConfig.delay,
        maxItems: runnerConfig.maxItems,
      });

      printRunSummary(result);
      console.log(`Run logs stored in ${resolve(logDir)} (runId: ${runId})`);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('resume')
  .description('Resume a pipeline from the latest persisted step log')
  .requiredOption('-p, --pipeline <path>', 'Path to the pipeline module')
  .requiredOption('--run-id <id>', 'Run identifier to resume')
  .option('-m, --mode <mode>', 'Execution mode (development|production)', 'development')
  .option('--delay <ms>', 'Override delay between iterations in milliseconds', parseInteger)
  .option('--max-items <count>', 'Override maximum items to process', parseInteger)
  .option('--start-step <id>', 'Explicit step identifier to resume from')
  .option('--log-dir <path>', 'Directory for step logs', './logs')
  .action(async (options: ResumeCliOptions) => {
    try {
      const pipelinePath = ensureStringOption('pipeline', options.pipeline);
      const runId = ensureStringOption('run-id', options.runId);
      const logDir = options.logDir ?? './logs';
      const mode = ensureMode(options.mode ?? 'development');
      const pipeline = await loadPipelineModule(pipelinePath, { mode, runId });

      const runnerConfig = overrideConfig(pipeline.config, {
        mode,
        delay: options.delay,
        maxItems: options.maxItems,
      });

      const stepLogger = createStepLogger({
        logDir,
        runId,
        isProduction: mode === 'production',
      });

      const lifecycle = composeLifecycle(stepLogger, pipeline.lifecycle);

      const runner = new ScrapeRunnerImpl(runnerConfig, lifecycle);
      runner.setSteps(pipeline.steps);

      const logs = await stepLogger.getAllLogs();
      if (logs.length === 0) {
        console.log('No logs found for the provided run id. Nothing to resume.');
        return;
      }

      const inferredStepId = inferResumeStepId(logs, options.startStep, pipeline.steps);
      const state = await stepLogger.buildRunnerState(inferredStepId);
      const orderedSteps = pipeline.steps;
      state.currentStepId = inferredStepId;
      state.stepIndex = Math.max(
        orderedSteps.findIndex((step) => step.id === inferredStepId),
        0,
      );

      console.log(`Resuming run ${runId} from step ${state.currentStepId}`);
      const result = await runner.resume(state, {
        mode,
        delay: runnerConfig.delay,
        maxItems: runnerConfig.maxItems,
        startStepId: state.currentStepId,
      });

      printRunSummary(result);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('retry-failed')
  .description('Retry all failed steps for a run')
  .requiredOption('-p, --pipeline <path>', 'Path to the pipeline module')
  .requiredOption('--run-id <id>', 'Run identifier whose failed steps should be retried')
  .option('-m, --mode <mode>', 'Execution mode (development|production)', 'development')
  .option('--delay <ms>', 'Override delay between iterations in milliseconds', parseInteger)
  .option('--max-items <count>', 'Override maximum items to process', parseInteger)
  .option('--log-dir <path>', 'Directory for step logs', './logs')
  .action(async (options: RetryCliOptions) => {
    try {
      const pipelinePath = ensureStringOption('pipeline', options.pipeline);
      const runId = ensureStringOption('run-id', options.runId);
      const logDir = options.logDir ?? './logs';
      const mode = ensureMode(options.mode ?? 'development');
      const pipeline = await loadPipelineModule(pipelinePath, { mode, runId });

      const runnerConfig = overrideConfig(pipeline.config, {
        mode,
        delay: options.delay,
        maxItems: options.maxItems,
      });

      const stepLogger = createStepLogger({
        logDir,
        runId,
        isProduction: mode === 'production',
      });

      const lifecycle = composeLifecycle(stepLogger, pipeline.lifecycle);

      const runner = new ScrapeRunnerImpl(runnerConfig, lifecycle);
      runner.setSteps(pipeline.steps);

      const logs = await stepLogger.getAllLogs();
      const failedSteps = logs.filter((log) => log.fails.length > 0);

      if (failedSteps.length === 0) {
        console.log('No failed steps recorded for this run.');
        return;
      }

      for (const failed of failedSteps) {
        console.log(`Retrying step ${failed.stepId} (previous failures: ${failed.fails.join(', ')})`);
        await runner.run({
          mode,
          delay: runnerConfig.delay,
          maxItems: runnerConfig.maxItems,
          startStepId: failed.stepId,
        });
        await stepLogger.clearStep(failed.stepId);
      }

      console.log('Retry process finished.');
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('status')
  .description('Display step log status for a run')
  .requiredOption('--run-id <id>', 'Run identifier to inspect')
  .option('--log-dir <path>', 'Directory for step logs', './logs')
  .action(async (options: StatusCliOptions) => {
    try {
      const logDir = options.logDir ?? './logs';
      const runId = ensureStringOption('run-id', options.runId);
      const stepLogger = createStepLogger({
        logDir,
        runId,
        isProduction: true,
      });

      const logs = await stepLogger.getAllLogs();
      if (logs.length === 0) {
        console.log('No logs found.');
        return;
      }

      console.log(`Status for run ${runId}:`);
      for (const log of logs) {
        const fails =
          log.fails.length > 0 ? `fails: ${log.fails.join(', ')}` : 'fails: none';
        console.log(
          `• ${log.stepId} -> index: ${log.index}, ${fails}, updated: ${log.updatedAt}`,
        );
      }
    } catch (error) {
      handleCliError(error);
    }
  });

void program.parseAsync(process.argv);

async function loadPipelineModule(
  pipelinePath: string,
  context: PipelineExecutionContext,
): Promise<PipelineModule> {
  const absPath = resolve(process.cwd(), pipelinePath);
  const moduleUrl = pathToFileURL(absPath).href;
  const imported = (await import(moduleUrl)) as Record<string, unknown>;
  const candidate =
    (imported.default as PipelineExport | undefined) ??
    (imported.pipeline as PipelineExport | undefined) ??
    (imported.createPipeline as PipelineExport | undefined);

  if (!candidate) {
    throw new Error(
      `Pipeline module "${pipelinePath}" does not export a valid pipeline definition.`,
    );
  }

  const maybePipeline =
    typeof candidate === 'function' ? await candidate(context) : candidate;

  if (!isPipelineModule(maybePipeline)) {
    throw new Error(
      `Pipeline module "${pipelinePath}" returned an invalid pipeline definition.`,
    );
  }

  return maybePipeline;
}

function isPipelineModule(value: unknown): value is PipelineModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const module = value as PipelineModule;
  return (
    module.config !== undefined &&
    Array.isArray(module.steps)
  );
}

function overrideConfig(
  config: RunnerConfig,
  overrides: Partial<Pick<RunnerConfig, 'mode' | 'delay' | 'maxItems'>>,
): RunnerConfig {
  return {
    ...config,
    ...(overrides.mode ? { mode: overrides.mode } : {}),
    ...(overrides.delay !== undefined ? { delay: overrides.delay } : {}),
    ...(overrides.maxItems !== undefined ? { maxItems: overrides.maxItems } : {}),
  };
}

function createStepLogger(options: StepLoggerOptions): StepLogger {
  return new StepLogger({
    ...options,
    persistInProductionOnly: false,
  });
}

function composeLifecycle(
  stepLogger: StepLogger,
  pipelineLifecycle?: RunnerLifecycle,
): RunnerLifecycle {
  return {
    beforeStep: async (event) => {
      await stepLogger.setLogForCurrentStepIndex(event.step.id, event.stepIndex);
      if (pipelineLifecycle?.beforeStep) {
        await pipelineLifecycle.beforeStep(event);
      }
    },
    afterStep: async (event) => {
      await stepLogger.setLogForCurrentStepIndex(event.step.id, 0);
      if (pipelineLifecycle?.afterStep) {
        await pipelineLifecycle.afterStep(event);
      }
    },
    onError: async (event) => {
      await stepLogger.setLogForCurrentStepFails(event.step.id, event.stepIndex);
      if (pipelineLifecycle?.onError) {
        await pipelineLifecycle.onError(event);
      }
    },
  };
}

function ensureMode(mode: string): RunnerConfig['mode'] {
  if (mode !== 'development' && mode !== 'production') {
    throw new Error(`Invalid mode "${mode}". Expected "development" or "production".`);
  }
  return mode;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value "${value}".`);
  }
  return parsed;
}

function inferResumeStepId(
  logs: StepLogRecord[],
  explicitStepId: string | undefined,
  steps: PipelineStep[],
): string {
  if (explicitStepId) {
    return explicitStepId;
  }

  const inProgress = logs.find((log) => log.index > 0);
  if (inProgress) {
    return inProgress.stepId;
  }

  const firstStep = steps[0];
  if (!firstStep) {
    throw new Error('Pipeline has no steps to resume.');
  }

  return firstStep.id;
}

function printRunSummary(result: RunResult): void {
  const durationSeconds = (result.durationMs / 1000).toFixed(2);
  console.log('Run complete:');
  console.log(`  Total steps:     ${result.totalSteps}`);
  console.log(`  Completed steps: ${result.completedSteps.join(', ') || 'none'}`);
  console.log(`  Failed steps:    ${result.failedSteps.join(', ') || 'none'}`);
  console.log(`  Started at:      ${result.startedAt.toISOString()}`);
  console.log(`  Finished at:     ${result.finishedAt.toISOString()}`);
  console.log(`  Duration:        ${durationSeconds}s`);
}

function handleCliError(error: unknown): void {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG?.toLowerCase() === 'true') {
      console.error(error.stack);
    }
  } else {
    console.error('An unknown error occurred.', error);
  }
  process.exitCode = 1;
}

function ensureStringOption(name: string, value: string | undefined): string {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required option "--${name}".`);
  }
  return value;
}

