import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { base64ToUint8Array, P2pStack } from './p2p';
import { error, IRequestStrict, json, Router, withParams } from 'itty-router';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

async function handleWsRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const webSocketPair = new WebSocketPair();
	const client = webSocketPair[0],
		server = webSocketPair[1];

	const p2pStack = await P2pStack.create(
		env,
		request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-real-ip') ?? '127.0.0.1',
		server,
	);

	ctx.waitUntil(p2pStack.start());

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}

type KadGetRequest = {
	params: {
		key: string;
	};
} & IRequestStrict;

type KadPutRequest = {
	params: {
		key: string;
	};
	json: () => Promise<{ value: string }>;
} & IRequestStrict;

async function apiHandler(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	if (request.method === 'GET' && request.url === '/ws') {
		return handleWsRequest(request, env, ctx);
	}

	const router = Router({
		before: [withParams],
		catch: error,
		finally: [json],
	});

	const getStack = async () => {
		return await P2pStack.create(env, request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-real-ip') ?? '127.0.0.1');
	};

	router
		.get<KadGetRequest>('/api/v1/kad/:key', async ({ params: { key } }) => {
			const stack = await getStack();
			ctx.waitUntil(stack.start());
			await stack.waitForStart();
			const resp = await stack.kad.get(key);
			return new Response(
				JSON.stringify({
					...resp,
					value: new TextDecoder().decode(resp?.value),
				}),
			);
		})
		.put<KadPutRequest>('/api/v1/kad/:key', async ({ params: { key }, json }) => {
			const { value } = await json();
			const stack = await getStack();
			ctx.waitUntil(stack.start());
			await stack.waitForStart();
			await stack.kad.put(key, new TextEncoder().encode(value));
			return new Response();
		})
		.get('/api/v1/kad/closest/:key', async ({ params: { key } }) => {
			const stack = await getStack();
			ctx.waitUntil(stack.start());
			await stack.waitForStart();
			const resp = await stack.kad.closestPeers(key);
			return new Response(JSON.stringify(resp));
		})
		.get('/api/v1/peer-id', async () => {
			const privateKey = await generateKeyPairFromSeed('Ed25519', base64ToUint8Array(env.SECRET_KEY_SEED));
			const peerId = peerIdFromPrivateKey(privateKey);
			return new Response(JSON.stringify({ peerId: peerId.toString() }));
		});

	return await router.fetch(request);
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader === 'websocket') {
			return handleWsRequest(request, env, ctx);
		}
		return await apiHandler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
