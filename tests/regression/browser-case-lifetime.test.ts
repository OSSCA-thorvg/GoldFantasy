import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserCaseLifetime } from './browser-case-lifetime.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const context = () => ({ close: vi.fn(async () => {}) });

describe('browser case deadlines and cleanup', () => {
  it('gives each case a fresh default 240-second budget and closes only its own context', async () => {
    const firstContext = context(),
      secondContext = context();
    const first = new BrowserCaseLifetime('sw-1', firstContext);
    await vi.advanceTimersByTimeAsync(90000);
    const second = new BrowserCaseLifetime('gl-2', secondContext);
    await vi.advanceTimersByTimeAsync(150000);
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(secondContext.close).not.toHaveBeenCalled();
    await first.finish(first.failure(new Error('Page closed')));
    await vi.advanceTimersByTimeAsync(89999);
    expect(secondContext.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(secondContext.close).toHaveBeenCalledTimes(1);
    await second.finish(second.failure(new Error('Page closed')));
  });

  it('clears a completed case timer before the next case starts', async () => {
    const firstContext = context(),
      secondContext = context();
    const first = new BrowserCaseLifetime('sw-1', firstContext, 100);
    await vi.advanceTimersByTimeAsync(50);
    await first.finish();
    expect(vi.getTimerCount()).toBe(0);
    const second = new BrowserCaseLifetime('gl-1', secondContext, 100);
    await vi.advanceTimersByTimeAsync(50);
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(secondContext.close).not.toHaveBeenCalled();
    await second.finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(secondContext.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an assertion error when cleanup also fails before the deadline', async () => {
    const original = new Error('The front resident was not selected');
    const closeError = new Error('Connection closed during cleanup');
    const target = {
      close: vi.fn(async () => {
        throw closeError;
      }),
    };
    const lifetime = new BrowserCaseLifetime('sw-2', target, 100);
    expect(lifetime.failure(original)).toBe(original);
    await expect(lifetime.finish(original)).resolves.toBeUndefined();
    expect(lifetime.failure(original)).toBe(original);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the named timeout instead of target-closed or cleanup errors', async () => {
    const closeError = new Error('browserContext.close: Target page, context or browser has been closed');
    const target = {
      close: vi.fn(async () => {
        throw closeError;
      }),
    };
    const lifetime = new BrowserCaseLifetime('gl-2', target, 20);
    await vi.advanceTimersByTimeAsync(20);
    const pageError = new Error('page.evaluate: Target page, context or browser has been closed');
    const failure = lifetime.failure(pageError);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(pageError);
    expect(failure).not.toBe(closeError);
    expect(failure.message).toBe('Picking gl-2 exceeded its 20ms case deadline');
    expect(lifetime.failure(new Error('Later closed-page rejection'))).toBe(failure);
    await expect(lifetime.finish(failure)).resolves.toBeUndefined();
    expect(target.close).toHaveBeenCalledTimes(1);
  });

  it('shares one pending close operation between timeout and repeated finish calls', async () => {
    let release = () => {
      throw new Error('Close has not started');
    };
    const target = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const lifetime = new BrowserCaseLifetime('gl-1', target, 10);
    await vi.advanceTimersByTimeAsync(10);
    const failure = lifetime.failure(new Error('Page closed'));
    const firstFinish = lifetime.finish(failure),
      secondFinish = lifetime.finish(failure);
    expect(target.close).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([firstFinish, secondFinish]);
    await lifetime.finish();
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces cleanup failure when the case itself succeeded', async () => {
    const closeError = new Error('Context cleanup failed');
    const target = {
      close: vi.fn(async () => {
        throw closeError;
      }),
    };
    const lifetime = new BrowserCaseLifetime('sw-1', target, 100);
    await expect(lifetime.finish()).rejects.toBe(closeError);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(target.close).toHaveBeenCalledTimes(1);
  });
});
