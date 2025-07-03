import pLimit, { type LimitFunction } from 'p-limit';

type ValueOf<T> = T extends Map<string, infer V> ? V : never;
type ProcessBatchFn = (batchKeys: string[]) => Promise<Map<string, any>>;
type BatchManagerOpts<T extends ProcessBatchFn> = {
	/**
	 * The maximum number of requests to process in parallel.
	 * @default 20
	 */
	batchSize?: number;
	/**
	 * Time in milliseconds before the batch is sent if the batch size is not reached.
	 * @default 1000
	 */
	batchTimeout?: number;
	/**
	 * The maximum number of requests to process in parallel.
	 * @default Infinity
	 */
	concurrency?: number;
	processBatch: T;
};

/**
 * BatchManager efficiently batches and processes requests with configurable
 * concurrency limits, batch sizes, and timeouts.
 *
 * This class collects individual requests into batches and processes them together
 * to improve performance and reduce the number of expensive operations (like API calls
 * or database queries).
 *
 * @template T - The type of the batch processing function
 *
 * @example
 * ```typescript
 * // Create a batch manager for API requests
 * const batchManager = new BatchManager({
 *   processBatch: async (productIds) => {
 *     // Make a single API call for multiple products
 *     const response = await fetch('/api/products', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ ids: productIds }),
 *     });
 *
 *     const products = await response.json();
 *     const resultMap = new Map();
 *
 *     products.forEach(product => {
 *       resultMap.set(product.id, product);
 *     });
 *
 *     return resultMap;
 *   },
 *   batchSize: 10,      // Process 10 items at once
 *   batchTimeout: 500,  // Wait max 500ms before processing incomplete batch
 *   concurrency: 3,     // Allow up to 3 concurrent batch operations
 * });
 *
 * // Use the batch manager
 * const product = await batchManager.get('product-123');
 * console.log(product);
 *
 * // Process multiple requests efficiently
 * const promises = ['product-1', 'product-2', 'product-3']
 *   .map(id => batchManager.get(id));
 * const products = await Promise.all(promises);
 * ```
 */
export class BatchManager<T extends ProcessBatchFn> {
	private batchSize: number = 20;
	private batchTimeout: number = 1000;
	private currentBatch: { key: string; resolve: (value: unknown) => void; reject: (reason?: any) => void }[] = [];
	private timeoutId: NodeJS.Timeout | null = null;
	private processBatch: T;
	private limit: LimitFunction;

	/**
	 * Creates a new BatchManager instance.
	 *
	 * @param opts - Configuration options for the batch manager
	 * @param opts.processBatch - Function that processes a batch of keys and returns a Map of results
	 * @param opts.batchSize - Maximum number of requests to process in a single batch (default: 20)
	 * @param opts.batchTimeout - Time in milliseconds to wait before processing an incomplete batch (default: 1000)
	 * @param opts.concurrency - Maximum number of batch operations to run in parallel (default: Infinity)
	 */
	constructor(opts: BatchManagerOpts<T>) {
		this.batchSize = opts?.batchSize ?? 20;
		if (this.batchSize <= 0) {
			throw new Error('batchSize must be greater than 0');
		}
		this.batchTimeout = opts?.batchTimeout ?? 1000;
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
	 * @returns A promise that resolves with the data for the given key, or undefined if the key is not found
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
	async get(key: string): Promise<ValueOf<Awaited<ReturnType<T>>> | undefined> {
		const promise = new Promise((resolve, reject) => {
			this.currentBatch.push({ key, resolve, reject });

			if (this.currentBatch.length === 1) {
				this.resetBatchTimeout();
			}

			if (this.currentBatch.length >= this.batchSize && this.batchSize > 0) {
				this._processBatch();
			}
		});

		return promise as Promise<ValueOf<Awaited<ReturnType<T>>> | undefined>;
	}

	private resetBatchTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
		}

		this.timeoutId = setTimeout(() => {
			if (this.currentBatch.length > 0) {
				this._processBatch();
			}
		}, this.batchTimeout);
	}

	private _processBatch() {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}

		const batch = [...this.currentBatch];
		this.currentBatch = [];

		const batchKeys = batch.map(item => item.key);

		this.limit(async () => {
			try {
				const result = await this.processBatch(batchKeys);
				if (!(result instanceof Map)) {
					throw new Error('processBatch must return a Map');
				}
				for (const { key, resolve } of batch) {
					resolve(result.get(key));
				}
			} catch (err) {
				for (const { reject } of batch) {
					reject(err);
				}
			}
		}).catch(err => {
			for (const { reject } of batch) {
				reject(err);
			}
		});
	}
}

export default BatchManager;
