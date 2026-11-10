/** Each browser condition receives its own bounded lifetime, independent of earlier conditions. */
export class BrowserCaseLifetime {
  constructor(name, context, timeoutMs = 240000) {
    this.context = context;
    this.closePromise = null;
    this.timeoutError = null;
    this.timer = setTimeout(() => {
      this.timeoutError = new Error(`Picking ${name} exceeded its ${timeoutMs}ms case deadline`);
      // Only this condition is aborted. The shared browser/server belong to the suite.
      void this.close().catch(() => {});
    }, timeoutMs);
  }

  close() {
    this.closePromise ??= Promise.resolve().then(() => this.context.close());
    return this.closePromise;
  }

  failure(error) {
    return this.timeoutError ?? error;
  }

  async finish(primaryError) {
    clearTimeout(this.timer);
    try {
      await this.close();
    } catch (error) {
      // A cleanup error must never replace the assertion or named timeout that failed the case.
      if (!primaryError) throw error;
    }
  }
}
