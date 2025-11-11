import { StepLogger } from '../../src/core/step-logger';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';

describe('StepLogger', () => {
  let logDir: string;
  let logger: StepLogger;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'scrapar-test-'));
    logger = new StepLogger({
      logDir,
      runId: 'test-run-123',
      isProduction: true,
    });
  });

  afterEach(async () => {
    try {
      await rm(logDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('setLogForCurrentStepIndex', () => {
    it('should set and persist step index', async () => {
      await logger.setLogForCurrentStepIndex('step-1', 5);

      const log = await logger.getLogByStep('step-1');
      expect(log?.index).toBe(5);
    });

    it('should not persist in development mode', async () => {
      const devLogger = new StepLogger({
        logDir,
        runId: 'test-run-dev',
        isProduction: false,
      });

      await devLogger.setLogForCurrentStepIndex('step-1', 10);

      // Check that no file was written
      const files = await fs.readdir(logDir);
      const logFiles = files.filter((f) => f.includes('test-run-dev') && f.endsWith('.json'));
      expect(logFiles.length).toBe(0);
    });
  });

  describe('setLogForCurrentStepFails', () => {
    it('should track failure IDs', async () => {
      await logger.setLogForCurrentStepFails('step-1', 1);
      await logger.setLogForCurrentStepFails('step-1', 2);

      const log = await logger.getLogByStep('step-1');
      expect(log?.fails).toEqual([1, 2]);
    });

    it('should handle string failure IDs', async () => {
      await logger.setLogForCurrentStepFails('step-1', 'item-123');

      const log = await logger.getLogByStep('step-1');
      // String IDs are stored as-is (conversion to number could be added if needed)
      expect(log?.fails).toContain('item-123');
    });
  });

  describe('getLogByStep', () => {
    it('should return default record for non-existent step', async () => {
      const log = await logger.getLogByStep('non-existent');
      expect(log).toBeDefined();
      expect(log.stepId).toBe('non-existent');
      expect(log.index).toBe(0);
      expect(log.fails).toEqual([]);
    });

    it('should return persisted log', async () => {
      await logger.setLogForCurrentStepIndex('step-1', 10);
      await logger.setLogForCurrentStepFails('step-1', 1);

      const log = await logger.getLogByStep('step-1');
      expect(log).toBeDefined();
      expect(log?.stepId).toBe('step-1');
      expect(log?.index).toBe(10);
      expect(log?.fails).toEqual([1]);
    });
  });

  describe('getAllLogs', () => {
    it('should return all step logs', async () => {
      await logger.setLogForCurrentStepIndex('step-1', 5);
      await logger.setLogForCurrentStepIndex('step-2', 10);

      const logs = await logger.getAllLogs();
      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.stepId)).toContain('step-1');
      expect(logs.map((l) => l.stepId)).toContain('step-2');
    });
  });

  describe('buildRunnerState', () => {
    it('should return undefined when no logs exist', async () => {
      const state = await logger.buildRunnerState();
      expect(state.currentStepId).toBe('');
      expect(state.stepIndex).toBe(0);
    });

    it('should return resume state with latest step', async () => {
      await logger.setLogForCurrentStepIndex('step-1', 5);
      await logger.setLogForCurrentStepIndex('step-2', 10);

      const state = await logger.buildRunnerState();
      expect(state).toBeDefined();
      expect(state.currentStepId).toBe('step-2');
      expect(state.stepIndex).toBe(10);
    });
  });
});
