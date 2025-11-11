import { JsonSink } from '../../src/sinks/json-sink';
import { ScrapeContextImpl } from '../../src/core/scrape-runner';
import type { RunnerConfig } from '../../src/types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';

describe('JsonSink', () => {
  let outputDir: string;
  let config: RunnerConfig;
  let context: ScrapeContextImpl;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'scrapar-sink-test-'));
    config = {
      mode: 'development',
      delay: 100,
    };
    context = new ScrapeContextImpl(config);
  });

  afterEach(async () => {
    try {
      await rm(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('write', () => {
    it('should write JSON data to file', async () => {
      const sink = new JsonSink({ outputDir, fileName: 'test-data' });
      const data = { id: 1, name: 'Test' };

      await sink.write(data, context);

      const filePath = join(outputDir, 'test-data.json');
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(data);
    });

    it('should create output directory if it does not exist', async () => {
      const nestedDir = join(outputDir, 'nested', 'path');
      const sink = new JsonSink({ outputDir: nestedDir, fileName: 'test' });
      const data = { test: true };

      await sink.write(data, context);

      const filePath = join(nestedDir, 'test.json');
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should log success message with item count for arrays', async () => {
      const sink = new JsonSink({
        outputDir,
        fileName: 'items',
        successMessage: 'Saved',
        calculateItemCount: true,
      });
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await sink.write(data, context);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Saved Items Count 3'),
      );
      consoleSpy.mockRestore();
    });

    it('should use custom filename builder', async () => {
      const sink = new JsonSink({
        outputDir,
        fileNameBuilder: (payload, ctx) => {
          return `custom-${ctx.runId}`;
        },
      });
      const data = { test: true };

      await sink.write(data, context);

      const filePath = join(outputDir, `custom-${context.runId}.json`);
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should use timestamped filename by default', async () => {
      const sink = new JsonSink({ outputDir });
      const data = { test: true };

      await sink.write(data, context);

      const files = await fs.readdir(outputDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThan(0);
      // Filename includes runId prefix, so check for timestamp pattern anywhere in the name
      expect(jsonFiles[0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });
  });

  describe('flush', () => {
    it('should be a no-op', async () => {
      const sink = new JsonSink({ outputDir });
      await expect(sink.flush()).resolves.toBeUndefined();
    });
  });
});

