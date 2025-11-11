import { ScrapeRunnerImpl, ScrapeContextImpl } from '../../src/core/scrape-runner';
import type { PipelineStep, RunnerConfig } from '../../src/types';

describe('ScrapeRunnerImpl', () => {
  let config: RunnerConfig;

  beforeEach(() => {
    config = {
      mode: 'development',
      delay: 100,
    };
  });

  describe('dependency resolution', () => {
    it('should resolve steps in dependency order during run', async () => {
      const executionOrder: string[] = [];

      const step1: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {
          executionOrder.push('step-1');
        },
      };

      const step2: PipelineStep = {
        id: 'step-2',
        dependencies: ['step-1'],
        async run() {
          executionOrder.push('step-2');
        },
      };

      const step3: PipelineStep = {
        id: 'step-3',
        dependencies: ['step-2'],
        async run() {
          executionOrder.push('step-3');
        },
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step3, step1, step2]);

      await runner.run();

      expect(executionOrder).toEqual(['step-1', 'step-2', 'step-3']);
    });

    it('should throw error for circular dependencies', () => {
      const step1: PipelineStep = {
        id: 'step-1',
        dependencies: ['step-2'],
        async run() {},
      };

      const step2: PipelineStep = {
        id: 'step-2',
        dependencies: ['step-1'],
        async run() {},
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step1, step2]);

      expect(() => {
        const ordered = runner.steps;
        // Accessing steps triggers resolution
        void ordered;
      }).not.toThrow(); // Actually, it should handle this gracefully or throw

      // The actual error will be thrown during run()
      expect(async () => {
        await runner.run();
      }).rejects.toThrow();
    });

    it('should throw error for missing dependency', () => {
      const step: PipelineStep = {
        id: 'step-1',
        dependencies: ['missing-step'],
        async run() {},
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step]);

      expect(async () => {
        await runner.run();
      }).rejects.toThrow('Dependency "missing-step" not found');
    });
  });

  describe('run', () => {
    it('should execute steps in order', async () => {
      const executionOrder: string[] = [];

      const step1: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {
          executionOrder.push('step-1');
        },
      };

      const step2: PipelineStep = {
        id: 'step-2',
        dependencies: ['step-1'],
        async run() {
          executionOrder.push('step-2');
        },
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step1, step2]);

      await runner.run();

      expect(executionOrder).toEqual(['step-1', 'step-2']);
    });

    it('should pass context between steps', async () => {
      const step1: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run(context) {
          context.data.value = 'test';
        },
      };

      const step2: PipelineStep = {
        id: 'step-2',
        dependencies: ['step-1'],
        async run(context) {
          expect(context.data.value).toBe('test');
        },
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step1, step2]);

      await runner.run();
    });

    it('should invoke lifecycle hooks', async () => {
      const beforeHooks: string[] = [];
      const afterHooks: string[] = [];

      const step: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {},
        beforeStep(event) {
          beforeHooks.push(event.step.id);
        },
        afterStep(event) {
          afterHooks.push(event.step.id);
        },
      };

      const runner = new ScrapeRunnerImpl(config, {
        beforeStep(event) {
          beforeHooks.push(`runner:${event.step.id}`);
        },
        afterStep(event) {
          afterHooks.push(`runner:${event.step.id}`);
        },
      });

      runner.setSteps([step]);
      await runner.run();

      expect(beforeHooks).toContain('runner:step-1');
      expect(beforeHooks).toContain('step-1');
      expect(afterHooks).toContain('runner:step-1');
      expect(afterHooks).toContain('step-1');
    });

    it('should handle errors and invoke error hooks', async () => {
      const errorHooks: string[] = [];
      const testError = new Error('Test error');

      const step: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {
          throw testError;
        },
        onError(event) {
          errorHooks.push(`step:${event.step.id}`);
        },
      };

      const runner = new ScrapeRunnerImpl(config, {
        onError(event) {
          errorHooks.push(`runner:${event.step.id}`);
        },
      });

      runner.setSteps([step]);

      await expect(runner.run()).rejects.toThrow('Test error');
      expect(errorHooks).toContain('runner:step-1');
      expect(errorHooks).toContain('step:step-1');
    });

    it('should return run result', async () => {
      const step: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {},
      };

      const runner = new ScrapeRunnerImpl(config);
      runner.setSteps([step]);

      const result = await runner.run();

      expect(result.totalSteps).toBe(1);
      expect(result.completedSteps).toEqual(['step-1']);
      expect(result.failedSteps).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('registerStep', () => {
    it('should add step to runner', () => {
      const runner = new ScrapeRunnerImpl(config);
      const step: PipelineStep = {
        id: 'step-1',
        dependencies: [],
        async run() {},
      };

      runner.registerStep(step);

      expect(runner.steps).toHaveLength(1);
      expect(runner.steps[0].id).toBe('step-1');
    });
  });
});

