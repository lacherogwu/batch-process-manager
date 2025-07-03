# Batch Process Manager

A TypeScript library for efficiently batching and processing requests with configurable concurrency limits, batch sizes, and timeouts.

## Features

- **Automatic Batching**: Collects individual requests into batches for efficient processing
- **Configurable Batch Size**: Control how many requests are processed together
- **Timeout Management**: Automatically processes incomplete batches after a specified timeout
- **Concurrency Control**: Limit the number of concurrent batch operations
- **Type Safety**: Full TypeScript support with proper generic types
- **Promise-based**: Simple async/await interface

## Installation

### NPM

```bash
npm install batch-process-manager
```

### GitHub

```bash
npm i https://github.com/lacherogwu/batch-process-manager
```

## Usage

### Basic Example

```typescript
import { BatchManager } from 'batch-process-manager';

// Create a batch manager
const batchManager = new BatchManager({
	processBatch: async batchKeys => {
		// Your batch processing logic here
		// This should return a Map where keys match the input keys
		const results = new Map();

		// Example: fetch data for multiple keys at once
		const data = await fetchMultipleItems(batchKeys);

		batchKeys.forEach((key, index) => {
			results.set(key, data[index]);
		});

		return results;
	},
	batchSize: 10, // Process 10 items at once
	batchTimeout: 1000, // Wait max 1 second before processing incomplete batch
	concurrency: 5, // Allow up to 5 concurrent batch operations
});

// Use the batch manager
const result = await batchManager.get('item-key');
console.log(result);
```

### Advanced Example

```typescript
import { BatchManager } from 'batch-process-manager';

// Example: Batch API requests for product data
const productBatchManager = new BatchManager({
	processBatch: async productIds => {
		// Make a single API call for multiple products
		const response = await fetch('/api/products', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: productIds }),
		});

		const products = await response.json();
		const resultMap = new Map();

		products.forEach(product => {
			resultMap.set(product.id, product);
		});

		return resultMap;
	},
	batchSize: 20,
	batchTimeout: 500,
	concurrency: 3,
});

// Process multiple requests efficiently
const promises = [];
for (let i = 1; i <= 100; i++) {
	promises.push(productBatchManager.get(`product-${i}`));
}

const products = await Promise.all(promises);
console.log(`Fetched ${products.length} products`);
```

## Configuration Options

### `BatchManagerOpts<T>`

| Option         | Type                                                 | Default      | Description                                                          |
| -------------- | ---------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `processBatch` | `(batchKeys: string[]) => Promise<Map<string, any>>` | **Required** | Function that processes a batch of keys and returns a Map of results |
| `batchSize`    | `number`                                             | `20`         | Maximum number of requests to process in a single batch              |
| `batchTimeout` | `number`                                             | `1000`       | Time in milliseconds to wait before processing an incomplete batch   |
| `concurrency`  | `number`                                             | `Infinity`   | Maximum number of batch operations to run in parallel                |

## How It Works

1. **Request Accumulation**: When you call `get(key)`, the request is added to the current batch
2. **Batch Triggering**: A batch is processed when either:
   - The batch reaches the configured `batchSize`
   - The `batchTimeout` expires
3. **Concurrent Processing**: Multiple batches can be processed simultaneously up to the `concurrency` limit
4. **Result Distribution**: Results from the batch processing function are distributed back to the individual promise resolvers

## Use Cases

- **API Rate Limiting**: Reduce API calls by batching requests
- **Database Queries**: Batch database lookups for better performance
- **Data Fetching**: Optimize data fetching in applications with many concurrent requests

## Error Handling

If the `processBatch` function throws an error, all requests in that batch will be rejected with the same error. If a specific key is not found in the returned Map, that individual request will resolve with `undefined`.

```typescript
try {
	const result = await batchManager.get('non-existent-key');
	if (result === undefined) {
		console.log('Key not found, but no error thrown');
	}
} catch (error) {
	console.error('Request failed:', error.message);
}
```

## TypeScript Support

The library provides full TypeScript support with proper generic types:

```typescript
type MyDataType = { id: string; name: string; price: number };

const typedBatchManager = new BatchManager({
	processBatch: async (keys: string[]): Promise<Map<string, MyDataType>> => {
		// Implementation here
		return new Map();
	},
});

// result is properly typed as MyDataType
const result = await typedBatchManager.get('key');
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
