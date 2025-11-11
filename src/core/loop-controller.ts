import humanizeDuration from 'humanize-duration';

export interface LoopControllerOptions {
  isProduction?: boolean;
  maxItems?: number;
  onProgress?: (current: number, total: number, remainingTime: number) => void;
  onFailure?: (index: number, error: unknown, item: unknown) => void;
  getCurrentStepValue?: () => number;
  setLogForCurrentStepIndex?: (index: number) => void;
}

export interface LoopFailure {
  index: number;
  error: unknown;
  item: unknown;
  timestamp: number;
}

export class LoopController {
  private readonly isProduction: boolean;
  private readonly maxItems: number;
  private readonly onProgress?: (current: number, total: number, remainingTime: number) => void;
  private readonly onFailure?: (index: number, error: unknown, item: unknown) => void;
  private readonly getCurrentStepValue?: () => number;
  private readonly setLogForCurrentStepIndex?: (index: number) => void;
  private readonly failures: LoopFailure[] = [];
  private intervalId?: NodeJS.Timeout;

  public static readonly DEFAULT_MAX_ITEMS = 10;

  constructor(options: LoopControllerOptions = {}) {
    this.isProduction = options.isProduction ?? false;
    this.maxItems = options.maxItems ?? LoopController.DEFAULT_MAX_ITEMS;
    this.onProgress = options.onProgress;
    this.onFailure = options.onFailure;
    this.getCurrentStepValue = options.getCurrentStepValue;
    this.setLogForCurrentStepIndex = options.setLogForCurrentStepIndex;
  }

  public loopDelay<T>(
    limit: number,
    todo: (i: number, list: T[]) => void | Promise<void>,
    done: (list: T[]) => void | Promise<void>,
    delay = 1000,
    i = 0,
    list: T[] = [],
  ): void {
    let adjustedLimit = limit;
    let startIndex = i;

    if (!this.isProduction && adjustedLimit > this.maxItems) {
      adjustedLimit = this.maxItems;
    }

    if (this.getCurrentStepValue && this.getCurrentStepValue() > 0) {
      startIndex = this.getCurrentStepValue();
      adjustedLimit -= startIndex;
      console.log('+> with continue mode...');
    }

    let currentIndex = startIndex;
    let remainingTime = (adjustedLimit + 2) * delay;

    this.intervalId = setInterval(async () => {
      if (currentIndex <= adjustedLimit) {
        try {
          await todo(currentIndex, list);
          if (this.setLogForCurrentStepIndex) {
            this.setLogForCurrentStepIndex(currentIndex);
          }

          remainingTime -= delay;
          const humanizedTime: string = humanizeDuration(remainingTime, { largest: 2 });
          console.log(`left time is ${humanizedTime}`);

          if (this.onProgress) {
            this.onProgress(currentIndex, adjustedLimit, remainingTime);
          }

          currentIndex++;
        } catch (error) {
          const failure: LoopFailure = {
            index: currentIndex,
            error,
            item: list[currentIndex],
            timestamp: Date.now(),
          };
          this.failures.push(failure);

          if (this.onFailure) {
            this.onFailure(currentIndex, error, list[currentIndex]);
          }

          currentIndex++;
        }
      } else {
        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = undefined;
        }

        if (this.setLogForCurrentStepIndex) {
          this.setLogForCurrentStepIndex(0);
        }

        await done(list);
      }
    }, delay);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  public getFailures(): readonly LoopFailure[] {
    return [...this.failures];
  }

  public clearFailures(): void {
    this.failures.length = 0;
  }

  public getRetryQueue(): readonly LoopFailure[] {
    return this.getFailures();
  }
}

export default LoopController;

