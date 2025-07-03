// src/index.ts
import pLimit from "p-limit";
var BatchRequestManager = class {
  batchSize = 20;
  batchTimeout = 1e3;
  currentBatch = [];
  timeoutId = null;
  processBatch;
  limit;
  /**
   * Creates a new BatchRequestManager instance.
   *
   * @param opts - Configuration options for the batch manager
   * @param opts.processBatch - Function that processes a batch of keys and returns a Map of results
   * @param opts.batchSize - Maximum number of requests to process in a single batch (default: 20)
   * @param opts.batchTimeout - Time in milliseconds to wait before processing an incomplete batch (default: 1000)
   * @param opts.concurrency - Maximum number of batch operations to run in parallel (default: Infinity)
   */
  constructor(opts) {
    this.batchSize = opts?.batchSize ?? 20;
    if (this.batchSize <= 0) {
      throw new Error("batchSize must be greater than 0");
    }
    this.batchTimeout = opts?.batchTimeout ?? 1e3;
    this.currentBatch = [];
    this.timeoutId = null;
    this.processBatch = opts.processBatch;
    this.limit = pLimit(opts.concurrency ?? Infinity);
  }
  /**
   * Retrieves a value for the given key, automatically batching the request with others.
   *
   * This method adds the request to the current batch. The batch will be processed when:
   * - The batch reaches the configured `batchSize`
   * - The `batchTimeout` expires
   *
   * @param key - The key to retrieve data for
   * @returns A promise that resolves with the data for the given key, or null if the key is not found
   *
   * @example
   * ```typescript
   * // Single request
   * const result = await batchManager.get('user-123');
   *
   * // Multiple concurrent requests (will be batched automatically)
   * const promises = ['user-1', 'user-2', 'user-3']
   *   .map(id => batchManager.get(id));
   * const users = await Promise.all(promises);
   * ```
   */
  async get(key) {
    const promise = new Promise((resolve, reject) => {
      this.currentBatch.push({ key, resolve, reject });
      if (this.currentBatch.length === 1) {
        this.resetBatchTimeout();
      }
      if (this.currentBatch.length >= this.batchSize && this.batchSize > 0) {
        this._processBatch();
      }
    });
    return promise;
  }
  resetBatchTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      if (this.currentBatch.length > 0) {
        this._processBatch();
      }
    }, this.batchTimeout);
  }
  _processBatch() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const batch = [...this.currentBatch];
    this.currentBatch = [];
    const batchKeys = batch.map((item) => item.key);
    this.limit(async () => {
      try {
        const result = await this.processBatch(batchKeys);
        if (!(result instanceof Map)) {
          throw new Error("processBatch must return a Map");
        }
        for (const { key, resolve } of batch) {
          resolve(result.get(key) ?? null);
        }
      } catch (err) {
        for (const { reject } of batch) {
          reject(err);
        }
      }
    }).catch((err) => {
      for (const { reject } of batch) {
        reject(err);
      }
    });
  }
};
var index_default = BatchRequestManager;
export {
  BatchRequestManager,
  index_default as default
};
