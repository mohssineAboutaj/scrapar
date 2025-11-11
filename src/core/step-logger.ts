import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { RunnerState } from '../types';

export interface StepLogRecord {
  stepId: string;
  index: number;
  fails: (number | string)[];
  updatedAt: string;
  payload?: Record<string, unknown>;
}

export interface StepLoggerOptions {
  /**
   * Directory where step logs are stored. Defaults to "./logs".
   */
  logDir?: string;
  /**
   * Identifier for the current run. Used as prefix for log files.
   */
  runId?: string;
  /**
   * When true, logs are written only when `isProduction` is true.
   */
  persistInProductionOnly?: boolean;
  /**
   * Indicates whether the current execution is running in production.
   */
  isProduction?: boolean;
}

export class StepLogger {
  private readonly logDir: string;
  private readonly runId: string;
  private readonly persistInProductionOnly: boolean;
  private readonly isProduction: boolean;

  constructor(options: StepLoggerOptions = {}) {
    this.logDir = resolve(options.logDir ?? './logs');
    this.runId = options.runId ?? `run-${Date.now()}`;
    this.persistInProductionOnly = options.persistInProductionOnly ?? true;
    this.isProduction = options.isProduction ?? false;
  }

  /**
   * Update the current index for a given step and persist the change.
   */
  public async setLogForCurrentStepIndex(stepId: string, index: number): Promise<void> {
    if (!this.shouldPersist()) {
      return;
    }

    const record = await this.readStep(stepId);
    record.index = index;
    if (index === 0) {
      record.fails = [];
    }
    record.updatedAt = this.timestamp();
    await this.writeStep(record);
  }

  /**
   * Append a failure identifier to the step record.
   */
  public async setLogForCurrentStepFails(stepId: string, failureId: number | string): Promise<void> {
    if (!this.shouldPersist()) {
      return;
    }

    const record = await this.readStep(stepId);
    record.fails = [...record.fails, failureId];
    record.updatedAt = this.timestamp();
    await this.writeStep(record);
  }

  /**
   * Store arbitrary payload for a step (used for resume/retry flows).
   */
  public async setStepPayload(stepId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.shouldPersist()) {
      return;
    }

    const record = await this.readStep(stepId);
    record.payload = { ...record.payload, ...payload };
    record.updatedAt = this.timestamp();
    await this.writeStep(record);
  }

  /**
   * Retrieve the persisted log for a specific step.
   */
  public async getLogByStep(stepId: string): Promise<StepLogRecord> {
    return await this.readStep(stepId);
  }

  /**
   * Return all log records for the current run.
   */
  public async getAllLogs(): Promise<StepLogRecord[]> {
    const files = await this.safeReadDir(this.logDir);
    const prefix = this.filePrefix();
    const relevant = files.filter((file) => file.startsWith(prefix) && file.endsWith('.json'));
    const records: StepLogRecord[] = [];

    for (const file of relevant) {
      const content = await this.safeReadFile(join(this.logDir, file));
      if (content) {
        try {
          records.push(JSON.parse(content) as StepLogRecord);
        } catch {
          // Ignore malformed files but keep processing the rest.
        }
      }
    }

    return records.sort(
      (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );
  }

  /**
   * Build a runner state snapshot from existing logs.
   */
  public async buildRunnerState(currentStepId?: string): Promise<RunnerState> {
    const logs = await this.getAllLogs();
    const completedStepIds = logs.filter((log) => log.index === 0).map((log) => log.stepId);
    const failedStepIds = logs.filter((log) => log.fails.length > 0).map((log) => log.stepId);
    const payload: Record<string, unknown> = {};

    for (const log of logs) {
      if (log.payload) {
        payload[log.stepId] = log.payload;
      }
    }

    const reversedLogs = [...logs].reverse();
    const lastInProgress = reversedLogs.find((log) => log.index > 0);
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : undefined;
    const inferredCurrentStep =
      currentStepId ?? lastInProgress?.stepId ?? lastLog?.stepId ?? '';
    const inferredIndex = logs.find((log) => log.stepId === inferredCurrentStep)?.index ?? 0;

    return {
      currentStepId: inferredCurrentStep,
      stepIndex: inferredIndex,
      completedStepIds,
      failedStepIds,
      payload,
    };
  }

  /**
   * Clear the log file for a specific step.
   */
  public async clearStep(stepId: string): Promise<void> {
    if (!this.shouldPersist()) {
      return;
    }

    const filePath = this.buildFilePath(stepId);
    await fs.rm(filePath, { force: true });
  }

  /**
   * Remove all logs associated with the current run.
   */
  public async clearAll(): Promise<void> {
    if (!this.shouldPersist()) {
      return;
    }

    const files = await this.safeReadDir(this.logDir);
    const prefix = this.filePrefix();
    await Promise.all(
      files
        .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
        .map((file) => fs.rm(join(this.logDir, file), { force: true })),
    );
  }

  private shouldPersist(): boolean {
    if (!this.persistInProductionOnly) {
      return true;
    }

    return this.isProduction;
  }

  private filePrefix(): string {
    return `${this.runId}-`;
  }

  private buildFilePath(stepId: string): string {
    return join(this.logDir, `${this.filePrefix()}${stepId}.json`);
  }

  private async readStep(stepId: string): Promise<StepLogRecord> {
    const filePath = this.buildFilePath(stepId);
    const content = await this.safeReadFile(filePath);

    if (!content) {
      const record: StepLogRecord = {
        stepId,
        index: 0,
        fails: [],
        updatedAt: this.timestamp(),
      };
      return record;
    }

    try {
      return JSON.parse(content) as StepLogRecord;
    } catch {
      return {
        stepId,
        index: 0,
        fails: [],
        updatedAt: this.timestamp(),
      };
    }
  }

  private async writeStep(record: StepLogRecord): Promise<void> {
    const filePath = this.buildFilePath(record.stepId);
    await this.ensureDirectoryExists(dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private async safeReadDir(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async safeReadFile(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}

export default StepLogger;

