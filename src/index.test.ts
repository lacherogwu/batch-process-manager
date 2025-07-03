import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchManager } from '../src/index.js';

describe('BatchManager', () => {
	let batchManager: BatchManager<any>;
	let mockProcessBatch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		mockProcessBatch = vi.fn();
		batchManager = new BatchManager({
			processBatch: mockProcessBatch,
			batchSize: 3,
			batchTimeout: 1000,
			concurrency: 2,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('constructor', () => {
		it('should initialize with default values', () => {
			const manager = new BatchManager({
				processBatch: vi.fn(),
			});

			expect(manager).toBeDefined();
		});

		it('should initialize with custom values', () => {
			const processBatch = vi.fn();
			const manager = new BatchManager({
				processBatch,
				batchSize: 5,
				batchTimeout: 500,
				concurrency: 3,
			});

			expect(manager).toBeDefined();
		});
	});

	describe('get method', () => {
		it('should return a promise', () => {
			const promise = batchManager.get('test-key');
			expect(promise).toBeInstanceOf(Promise);
		});

		it('should batch requests and process them when batch size is reached', async () => {
			const mockResult = new Map([
				['key1', 'value1'],
				['key2', 'value2'],
				['key3', 'value3'],
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promises = [batchManager.get('key1'), batchManager.get('key2'), batchManager.get('key3')];

			const results = await Promise.all(promises);

			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(mockProcessBatch).toHaveBeenCalledWith(['key1', 'key2', 'key3']);
			expect(results).toEqual(['value1', 'value2', 'value3']);
		});

		it('should process batch after timeout even if batch size is not reached', async () => {
			const mockResult = new Map([
				['key1', 'value1'],
				['key2', 'value2'],
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promises = [batchManager.get('key1'), batchManager.get('key2')];

			// Fast-forward time to trigger timeout
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(mockProcessBatch).toHaveBeenCalledWith(['key1', 'key2']);
			expect(results).toEqual(['value1', 'value2']);
		});

		it('should handle multiple batches correctly', async () => {
			const mockResult1 = new Map([
				['key1', 'value1'],
				['key2', 'value2'],
				['key3', 'value3'],
			]);
			const mockResult2 = new Map([
				['key4', 'value4'],
				['key5', 'value5'],
			]);

			mockProcessBatch.mockResolvedValueOnce(mockResult1).mockResolvedValueOnce(mockResult2);

			// First batch (will trigger immediately due to batch size of 3)
			const firstBatch = [batchManager.get('key1'), batchManager.get('key2'), batchManager.get('key3')];

			// Second batch (will trigger after timeout since only 2 items)
			const secondBatch = [batchManager.get('key4'), batchManager.get('key5')];

			// Wait for first batch to complete
			const firstResults = await Promise.all(firstBatch);

			// Fast-forward time to trigger timeout for second batch
			vi.advanceTimersByTime(1000);

			const secondResults = await Promise.all(secondBatch);

			expect(mockProcessBatch).toHaveBeenCalledTimes(2);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(1, ['key1', 'key2', 'key3']);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(2, ['key4', 'key5']);
			expect(firstResults).toEqual(['value1', 'value2', 'value3']);
			expect(secondResults).toEqual(['value4', 'value5']);
		});

		it('should return undefined for keys not found in result', async () => {
			const mockResult = new Map([
				['key1', 'value1'],
				// key2 is missing
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promise1 = batchManager.get('key1');
			const promise2 = batchManager.get('key2');

			// Advance time to trigger timeout processing
			vi.advanceTimersByTime(1000);

			await expect(promise1).resolves.toBe('value1');
			await expect(promise2).resolves.toBe(undefined);
		});

		it('should reject all requests in batch when processBatch throws an error', async () => {
			const error = new Error('Processing failed');
			mockProcessBatch.mockRejectedValue(error);

			const promises = [batchManager.get('key1'), batchManager.get('key2'), batchManager.get('key3')];

			await expect(Promise.all(promises)).rejects.toThrow('Processing failed');
		});

		it('should handle concurrent requests correctly', async () => {
			const mockResult = new Map([
				['key1', 'value1'],
				['key2', 'value2'],
				['key3', 'value3'],
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			// Create promises concurrently
			const promises = await Promise.all([batchManager.get('key1'), batchManager.get('key2'), batchManager.get('key3')]);

			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(promises).toEqual(['value1', 'value2', 'value3']);
		});

		it('should handle duplicate keys correctly', async () => {
			const mockResult = new Map([['key1', 'value1']]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promises = [batchManager.get('key1'), batchManager.get('key1'), batchManager.get('key1')];

			const results = await Promise.all(promises);

			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(mockProcessBatch).toHaveBeenCalledWith(['key1', 'key1', 'key1']);
			expect(results).toEqual(['value1', 'value1', 'value1']);
		});
	});

	describe('timeout behavior', () => {
		it('should reset timeout when first request is added to empty batch', async () => {
			const mockResult = new Map([['key1', 'value1']]);
			mockProcessBatch.mockResolvedValue(mockResult);

			// Add first request - should start timeout
			const promise = batchManager.get('key1');

			// Advance time to trigger timeout
			vi.advanceTimersByTime(1000);

			await expect(promise).resolves.toBe('value1');
			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(mockProcessBatch).toHaveBeenCalledWith(['key1']);
		});

		it('should not reset timeout when new requests are added to non-empty batch', async () => {
			const mockResult = new Map([['key1', 'value1']]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promise = batchManager.get('key1');

			// Advance time by half the timeout
			vi.advanceTimersByTime(500);

			// Add another request - this should NOT reset the timeout
			const promise2 = batchManager.get('key2');

			// Advance time by the remaining timeout (should trigger processing)
			vi.advanceTimersByTime(500);

			// Both requests should be processed in the same batch
			await expect(promise).resolves.toBe('value1');
			await expect(promise2).resolves.toBe(undefined);

			// Verify they were processed in a single batch
			expect(mockProcessBatch).toHaveBeenCalledOnce();
			expect(mockProcessBatch).toHaveBeenCalledWith(['key1', 'key2']);
		});

		it('should start new timeout when adding first request after previous batch completes', async () => {
			const mockResult1 = new Map([['key1', 'value1']]);
			const mockResult2 = new Map([['key2', 'value2']]);
			mockProcessBatch.mockResolvedValueOnce(mockResult1).mockResolvedValueOnce(mockResult2);

			// First request triggers timeout
			const promise1 = batchManager.get('key1');
			vi.advanceTimersByTime(1000);
			await expect(promise1).resolves.toBe('value1');

			// Second request should start a new timeout
			const promise2 = batchManager.get('key2');
			vi.advanceTimersByTime(1000);
			await expect(promise2).resolves.toBe('value2');

			expect(mockProcessBatch).toHaveBeenCalledTimes(2);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(1, ['key1']);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(2, ['key2']);
		});

		it('should cancel timeout when batch is processed due to size limit', async () => {
			const mockResult = new Map([
				['key1', 'value1'],
				['key2', 'value2'],
				['key3', 'value3'],
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			// Add requests to reach batch size
			const promises = [
				batchManager.get('key1'),
				batchManager.get('key2'),
				batchManager.get('key3'), // This should trigger immediate processing
			];

			await Promise.all(promises);

			// Fast-forward time - should not trigger another batch
			vi.advanceTimersByTime(1000);

			expect(mockProcessBatch).toHaveBeenCalledOnce();
		});
	});

	describe('concurrency control', () => {
		it('should respect concurrency limits', async () => {
			let processingCount = 0;
			let maxConcurrentProcessing = 0;
			const processingOrder: number[] = [];

			const slowProcessBatch = vi.fn().mockImplementation(async (keys: string[]) => {
				processingCount++;
				const currentProcessingId = processingCount;
				maxConcurrentProcessing = Math.max(maxConcurrentProcessing, processingCount);
				processingOrder.push(currentProcessingId);

				// Simulate processing time by waiting for next tick
				await Promise.resolve();

				processingCount--;

				const result = new Map();
				keys.forEach(key => result.set(key, `value-${key}`));
				return result;
			});

			const manager = new BatchManager({
				processBatch: slowProcessBatch,
				batchSize: 2,
				batchTimeout: 1000,
				concurrency: 2, // Limit to 2 concurrent batches
			});

			// Create 6 requests (should create 3 batches)
			const promises = [
				manager.get('key1'),
				manager.get('key2'), // First batch (processed immediately)
				manager.get('key3'),
				manager.get('key4'), // Second batch (processed immediately)
				manager.get('key5'),
				manager.get('key6'), // Third batch (needs timeout)
			];

			// Advance time to trigger timeout for the third batch
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			// Should not exceed concurrency limit
			expect(maxConcurrentProcessing).toBeLessThanOrEqual(2);
			expect(results).toHaveLength(6);
			expect(slowProcessBatch).toHaveBeenCalledTimes(3);

			// Verify all results are correct
			results.forEach((result, index) => {
				expect(result).toBe(`value-key${index + 1}`);
			});
		});
	});

	describe('edge cases', () => {
		it('should handle empty processBatch result', async () => {
			mockProcessBatch.mockResolvedValue(new Map());

			const promise = batchManager.get('key1');

			// Advance time to trigger timeout processing
			vi.advanceTimersByTime(1000);

			await expect(promise).resolves.toBe(undefined);
		});

		it('should handle processBatch returning null/undefined values', async () => {
			const mockResult = new Map([
				['key1', null],
				['key2', undefined],
				['key3', ''],
				['key4', 0],
				['key5', false],
			] as [string, any][]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promises = [batchManager.get('key1'), batchManager.get('key2'), batchManager.get('key3'), batchManager.get('key4'), batchManager.get('key5')];

			// Advance time to trigger timeout processing since we have 5 items but batch size is 3
			// The first batch of 3 will be processed immediately, then we need to trigger timeout for the remaining 2
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			// Note: undefined values from processBatch are now preserved as undefined
			expect(results).toEqual([null, undefined, '', 0, false]);
		});

		it('should handle very large batch sizes', async () => {
			const largeManager = new BatchManager({
				processBatch: vi.fn().mockImplementation(async (keys: string[]) => {
					const result = new Map();
					keys.forEach(key => result.set(key, `value-${key}`));
					return result;
				}),
				batchSize: 1000,
				batchTimeout: 1000,
			});

			const promises = Array.from({ length: 500 }, (_, i) => largeManager.get(`key${i}`));

			// Advance time to trigger timeout processing since we have 500 items but batch size is 1000
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			expect(results).toHaveLength(500);
			expect(results[0]).toBe('value-key0');
			expect(results[499]).toBe('value-key499');
		});
	});

	describe('type safety', () => {
		it('should work with typed processBatch function', async () => {
			type TestData = { id: string; name: string };

			const typedProcessBatch = vi.fn().mockImplementation(async (keys: string[]): Promise<Map<string, TestData>> => {
				const result = new Map<string, TestData>();
				keys.forEach(key => result.set(key, { id: key, name: `Name for ${key}` }));
				return result;
			});

			const typedManager = new BatchManager({
				processBatch: typedProcessBatch,
				batchSize: 2,
			});

			const promise = typedManager.get('test-id');

			// Advance time to trigger timeout processing since we have 1 item but batch size is 2
			vi.advanceTimersByTime(1000);

			const result = await promise;

			expect(result).toEqual({ id: 'test-id', name: 'Name for test-id' });
			expect(typedProcessBatch).toHaveBeenCalledWith(['test-id']);
		});
	});

	describe('real-world scenarios', () => {
		it('should handle API-like batch processing', async () => {
			// Simulate API response
			const mockApiResponse = {
				users: [
					{ id: 'user1', name: 'Alice' },
					{ id: 'user2', name: 'Bob' },
					{ id: 'user3', name: 'Charlie' },
				],
			};

			const apiProcessBatch = vi.fn().mockImplementation(async (userIds: string[]) => {
				// Simulate API call delay - don't use setTimeout with fake timers
				await new Promise(resolve => {
					resolve(undefined);
				});

				const result = new Map();
				mockApiResponse.users.forEach(user => {
					if (userIds.includes(user.id)) {
						result.set(user.id, user);
					}
				});
				return result;
			});

			const apiManager = new BatchManager({
				processBatch: apiProcessBatch,
				batchSize: 5,
				batchTimeout: 200,
			});

			const promises = [apiManager.get('user1'), apiManager.get('user2'), apiManager.get('user3')];

			// Advance time to trigger timeout processing since we have 3 items but batch size is 5
			vi.advanceTimersByTime(200);

			const users = await Promise.all(promises);

			expect(users).toEqual([
				{ id: 'user1', name: 'Alice' },
				{ id: 'user2', name: 'Bob' },
				{ id: 'user3', name: 'Charlie' },
			]);
		});

		it('should handle database-like batch processing', async () => {
			// Simulate database records
			const mockDbRecords = [
				{ id: 1, title: 'Post 1', author: 'Author 1' },
				{ id: 2, title: 'Post 2', author: 'Author 2' },
				{ id: 3, title: 'Post 3', author: 'Author 3' },
			];

			const dbProcessBatch = vi.fn().mockImplementation(async (ids: string[]) => {
				// Simulate database query
				const numericIds = ids.map(id => parseInt(id));
				const result = new Map();

				mockDbRecords.forEach(record => {
					if (numericIds.includes(record.id)) {
						result.set(record.id.toString(), record);
					}
				});

				return result;
			});

			const dbManager = new BatchManager({
				processBatch: dbProcessBatch,
				batchSize: 10,
				batchTimeout: 100,
			});

			const promises = [dbManager.get('1'), dbManager.get('2'), dbManager.get('3')];

			// Advance time to trigger timeout processing since we have 3 items but batch size is 10
			vi.advanceTimersByTime(100);

			const posts = await Promise.all(promises);

			expect(posts).toEqual(mockDbRecords);
		});
	});

	describe('additional edge cases', () => {
		it('should throw error for zero batch size', async () => {
			expect(() => {
				new BatchManager({
					processBatch: vi.fn().mockResolvedValue(new Map([['key1', 'value1']])),
					batchSize: 0,
					batchTimeout: 100,
				});
			}).toThrow('batchSize must be greater than 0');
		});

		it('should throw error for negative batch size', async () => {
			expect(() => {
				new BatchManager({
					processBatch: vi.fn().mockResolvedValue(new Map([['key1', 'value1']])),
					batchSize: -5,
					batchTimeout: 100,
				});
			}).toThrow('batchSize must be greater than 0');
		});

		it('should handle zero timeout by processing immediately', async () => {
			const zeroTimeoutManager = new BatchManager({
				processBatch: vi.fn().mockResolvedValue(new Map([['key1', 'value1']])),
				batchSize: 10,
				batchTimeout: 0,
			});

			const promise = zeroTimeoutManager.get('key1');

			// Should process immediately due to zero timeout
			vi.advanceTimersByTime(0);

			await expect(promise).resolves.toBe('value1');
		});

		it('should handle concurrent get calls on same key', async () => {
			const mockResult = new Map([['key1', 'shared-value']]);
			mockProcessBatch.mockResolvedValue(mockResult);

			// Multiple concurrent calls for the same key
			const promises = Array.from({ length: 5 }, () => batchManager.get('key1'));

			// Since we have 5 requests and batch size is 3, first batch will process immediately
			// and second batch will need timeout trigger
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			// All should get the same value
			expect(results).toHaveLength(5);
			results.forEach(result => expect(result).toBe('shared-value'));

			// Should have been called at least twice due to batch size limit (3 + 2)
			expect(mockProcessBatch).toHaveBeenCalledTimes(2);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(1, ['key1', 'key1', 'key1']);
			expect(mockProcessBatch).toHaveBeenNthCalledWith(2, ['key1', 'key1']);
		});

		it('should handle processBatch returning wrong Map type', async () => {
			const invalidProcessBatch = vi.fn().mockResolvedValue(
				new Map([
					['key1', 'value1'],
					['123', 'valid-key-type'], // Valid key type
				]),
			);

			const invalidManager = new BatchManager({
				processBatch: invalidProcessBatch,
				batchSize: 2,
			});

			const promise = invalidManager.get('key1');

			// Advance time to trigger timeout processing since we have 1 item but batch size is 2
			vi.advanceTimersByTime(1000);

			await expect(promise).resolves.toBe('value1');
		});

		it('should handle very long key names', async () => {
			const longKey = 'a'.repeat(10000); // 10KB key
			const mockResult = new Map([[longKey, 'long-key-value']]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promise = batchManager.get(longKey);

			// Advance time to trigger timeout processing since we have 1 item but batch size is 3
			vi.advanceTimersByTime(1000);

			await expect(promise).resolves.toBe('long-key-value');
			expect(mockProcessBatch).toHaveBeenCalledWith([longKey]);
		});

		it('should throw error when processBatch returns non-Map', async () => {
			const invalidProcessBatch = vi.fn().mockResolvedValue({ key1: 'value1' }); // Not a Map

			const invalidManager = new BatchManager({
				processBatch: invalidProcessBatch as any,
				batchSize: 2,
			});

			const promise = invalidManager.get('key1');

			// Advance time to trigger timeout processing since we have 1 item but batch size is 2
			vi.advanceTimersByTime(1000);

			// Should throw the specific error message for non-Map returns
			await expect(promise).rejects.toThrow('processBatch must return a Map');
		});

		it('should handle undefined/null keys gracefully', async () => {
			const mockResult = new Map([
				['undefined', 'undefined-value'],
				['null', 'null-value'],
			]);
			mockProcessBatch.mockResolvedValue(mockResult);

			const promises = [batchManager.get('undefined'), batchManager.get('null')];

			// Advance time to trigger timeout processing since we have 2 items but batch size is 3
			vi.advanceTimersByTime(1000);

			const results = await Promise.all(promises);

			expect(results).toEqual(['undefined-value', 'null-value']);
		});
	});
});
