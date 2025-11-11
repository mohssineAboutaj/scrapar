import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Sink, ScrapeContext } from '../types';

type FileNameBuilder = <Payload>(this: void, payload: Payload, context: ScrapeContext) => string;

export interface JsonSinkOptions {
  /**
   * Directory where JSON files will be stored. Defaults to "./data".
   */
  outputDir?: string;
  /**
   * Optional static filename. When omitted a timestamp-based filename is used.
   */
  fileName?: string;
  /**
   * Function to build filenames dynamically based on the payload/context.
   * When provided it takes precedence over `fileName`.
   */
  fileNameBuilder?: FileNameBuilder;
  /**
   * Controls whether summary logging should include item count for arrays.
   */
  calculateItemCount?: boolean;
  /**
   * Custom success message to display after writing JSON.
   */
  successMessage?: string;
  /**
   * Indentation used when stringifying JSON.
   */
  indent?: number;
}

export class JsonSink<TPayload = unknown, TContext extends ScrapeContext = ScrapeContext>
  implements Sink<TPayload, TContext>
{
  public readonly id = 'json-sink';

  private readonly outputDir: string;
  private readonly fileName?: string;
  private readonly fileNameBuilder?: FileNameBuilder;
  private readonly calculateItemCount: boolean;
  private readonly successMessage: string;
  private readonly indent: number;

  constructor(options: JsonSinkOptions = {}) {
    this.outputDir = resolve(options.outputDir ?? './data');
    this.fileName = options.fileName;
    this.fileNameBuilder = options.fileNameBuilder;
    this.calculateItemCount = options.calculateItemCount ?? true;
    this.successMessage = options.successMessage ?? 'inserted successfully';
    this.indent = options.indent ?? 2;
  }

  public async write(payload: TPayload, context: TContext): Promise<void> {
    const filePath = this.buildFilePath(payload, context);
    await this.ensureDirectoryExists(dirname(filePath));

    const serialized = JSON.stringify(payload, null, this.indent);
    await fs.writeFile(filePath, serialized, 'utf8');

    if (this.successMessage) {
      const countMessage =
        Array.isArray(payload) && this.calculateItemCount
          ? `, Saved Items Count ${payload.length}`
          : '';

      console.log(`${this.successMessage}${countMessage} → ${filePath}`);
    }
  }

  public flush(): Promise<void> {
    // No-op for JSON sink but kept for interface completeness.
    return Promise.resolve();
  }

  private buildFilePath(payload: TPayload, context: TContext): string {
    const fileNameBuilder = this.fileNameBuilder;
    const rawFileName =
      (fileNameBuilder ? fileNameBuilder(payload, context) : undefined) ??
      this.fileName ??
      this.generateDefaultFileName(context);

    const normalized = rawFileName.endsWith('.json') ? rawFileName : `${rawFileName}.json`;
    return join(this.outputDir, normalized);
  }

  private generateDefaultFileName(context: TContext): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${context.runId}-${timestamp}`;
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

export default JsonSink;

