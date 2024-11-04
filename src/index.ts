/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { webSockets } from './transport';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { createDatastore } from './db/datastore';

const bootstrapMultiaddrs = [
	'/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
	'/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
];

function base64ToUint8Array(base64: string): Uint8Array {
	const binString = atob(base64);
	return new Uint8Array(binString.length).map((_, i) => binString.charCodeAt(i));
}

async function handleWsRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const webSocketPair = new WebSocketPair();
	const client = webSocketPair[0],
		server = webSocketPair[1];

	server.accept();

	const url = new URL(request.url);

	const node = await createLibp2p({
		datastore: createDatastore(env.libp2p_on_edge),
		start: false,
		addresses: {
			listen: [env.WORKER_MULTIADDR],
		},
		transports: [
			webSockets({
				server,
				remoteAddr: request.headers.get('CF-Connecting-IP') ?? '127.0.0.1',
				workerMultiaddr: env.WORKER_MULTIADDR,
			}),
		],
		connectionEncrypters: [
			noise({
				staticNoiseKey: base64ToUint8Array(env.SECRET_KEY_SEED),
			}),
		],
		streamMuxers: [yamux()],
		peerDiscovery: [
			bootstrap({
				list: bootstrapMultiaddrs,
			}),
		],
		logger: {
			forComponent(name) {
				console.log(name);
				const debug = (...args: any[]) => console.log(...args);
				return Object.assign(debug, {
					error: (...args: any[]) => console.error(...args),
					trace: (...args: any[]) => console.trace(...args),
					enabled: true,
				});
			},
		},
		services: {
			identify: identify(),
			ping: ping(),
			dht: kadDHT({
				protocol: '/ipfs/kad/1.0.0',
				peerInfoMapper: removePrivateAddressesMapper,
			}),
		},
	});

	const fut = new Promise<void>(async (resolve) => {
		console.log('starting libp2p');
		node.addEventListener('peer:discovery', (evt) => {
			console.log('Discovered %s', evt.detail.id.toString()); // Log discovered peer
		});

		node.addEventListener('peer:connect', (evt) => {
			console.log('Connected to %s', evt.detail.toString()); // Log connected peer
		});
		node.start();
		console.log(node.getMultiaddrs());
		console.log('libp2p has started');

		server.addEventListener('close', async () => {
			await node.stop();
			console.log('libp2p has stopped');
			resolve();
		});
	});

	ctx.waitUntil(fut);

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader === 'websocket') {
			return handleWsRequest(request, env, ctx);
		}
		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
