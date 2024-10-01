// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF, fetchMock } from 'cloudflare:test';
import { expect, vi, test, beforeAll, afterEach } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

beforeAll(() => {
	// Enable outbound request mocking...
	fetchMock.activate();
	// ...and throw errors if an outbound request isn't mocked
	fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

test('test ', async () => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);

		if (request.method === 'POST' && url.origin === 'https://example.com') {
			return new Response(`${url.pathname}`);
		}

		throw new Error('No mock found');
	});

	let response = await SELF.fetch('https://example.com/path', { method: 'POST' });
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('/path');
	vi.resetAllMocks();
});

test('Caches the response for the same POST request body', async () => {
	// Mock the fetch implementation to simulate the origin response

	const body = JSON.stringify({ data: 'test' });
	const ctx = createExecutionContext();
	let response = await worker.fetch(
		new IncomingRequest('https://example.com/path', {
			method: 'POST',
			body,
		}),
		env,
		ctx
	);
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Fetched from origin');

	// Spy on the cache to ensure that it was stored
	const cacheSpy = vi.spyOn(caches.default, 'put');

	// Mock the fetch again, but this time expect it to be served from the cache
	response = await SELF.fetch('https://example.com/path', {
		method: 'POST',
		body,
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Fetched from origin'); // Same response

	expect(cacheSpy).toHaveBeenCalled();
	vi.resetAllMocks();
});

test('Fetches from origin if the cache is empty', async () => {
	// Simulate fetch from origin
	vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input, init) => {
		return new Response('Origin response', { status: 200 });
	});

	const body = JSON.stringify({ data: 'test' });
	const response = await SELF.fetch('https://example.com/path', {
		method: 'POST',
		body,
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Origin response');
	vi.resetAllMocks();
});

test('Caches responses based on different POST request bodies', async () => {
	// Spy on cache.match and cache.put
	const cacheMatchSpy = vi.spyOn(caches.default, 'match');
	const cachePutSpy = vi.spyOn(caches.default, 'put');

	// Mock fetch to simulate origin response
	vi.spyOn(globalThis, 'fetch')
		.mockImplementationOnce(async (input, init) => {
			return new Response('Response for test1', { status: 200 });
		})
		.mockImplementationOnce(async (input, init) => {
			return new Response('Response for test2', { status: 200 });
		});

	// First POST request with body 'test1'
	const body1 = JSON.stringify({ data: 'test1' });
	let response = await SELF.fetch('https://example.com/path', {
		method: 'POST',
		body: body1,
	});

	// Assert the response was fetched from origin and cached
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Response for test1');
	expect(cacheMatchSpy).toHaveBeenCalled(); // Cache was checked
	expect(cachePutSpy).toHaveBeenCalled(); // Response was cached

	// Second POST request with a different body 'test2'
	const body2 = JSON.stringify({ data: 'test2' });
	response = await SELF.fetch('https://example.com/path', {
		method: 'POST',
		body: body2,
	});

	// Assert a different response for the different body and that it was cached separately
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Response for test2');
	expect(cacheMatchSpy).toHaveBeenCalled(); // Cache was checked
	expect(cachePutSpy).toHaveBeenCalledTimes(2); // New response was cached separately
	vi.resetAllMocks();
});

test('Bypasses cache for non-POST requests', async () => {
	vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input, init) => {
		return new Response('Origin GET response', { status: 200 });
	});

	const response = await SELF.fetch('https://example.com/path', { method: 'GET' });
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('Origin GET response');
	vi.resetAllMocks();
});
