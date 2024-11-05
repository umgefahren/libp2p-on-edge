import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { Identify, identify } from '@libp2p/identify';
import { EventTypes, KadDHT, kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { ping, PingService } from '@libp2p/ping';
import { createLibp2p, Libp2p } from 'libp2p';
import { createDatastore } from './db/datastore';
import { webSockets } from './transport';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { all } from './transport/filters';

const bootstrapMultiaddrs = [
	'/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
	'/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
];

function base64ToUint8Array(base64: string): Uint8Array {
	const binString = atob(base64);
	return Uint8Array.from(binString, (char) => char.charCodeAt(0));
}

interface GetResponse {
	value: Uint8Array;
	provider: string;
}

export class KadHandler {
	constructor(private readonly node: Libp2p<{ dht: KadDHT }>) {}

	public async get(key: string): Promise<GetResponse | null> {
		const stream = this.node.services.dht.get(new TextEncoder().encode(key));
		let bestRet = null;
		for await (const obj of stream) {
			switch (obj.type) {
				case EventTypes.VALUE:
					{
						bestRet = {
							value: obj.value,
							provider: obj.from.toString(),
						} as GetResponse;
					}
					break;
				case EventTypes.QUERY_ERROR: {
					console.error(obj.error);
				}
			}
		}
		return bestRet;
	}

	public async put(key: string, value: Uint8Array): Promise<void> {
		const stream = this.node.services.dht.put(new TextEncoder().encode(key), value);

		for await (const obj of stream) {
			switch (obj.type) {
				case EventTypes.QUERY_ERROR: {
					console.error(obj.error);
				}
			}
		}
	}

	public async closestPeers(key: string): Promise<string[]> {
		const stream = this.node.services.dht.getClosestPeers(new TextEncoder().encode(key));
		const peers: Set<string> = new Set();
		for await (const obj of stream) {
			switch (obj.type) {
				case EventTypes.PROVIDER: {
					for (const peer of obj.providers) {
						peers.add(peer.toString());
					}
					break;
				}
				case EventTypes.FINAL_PEER: {
					peers.add(obj.peer.id.toString());
					break;
				}
				case EventTypes.QUERY_ERROR: {
					console.error(obj.error);
				}
			}
		}

		const allPeers = Array.from(peers);
		allPeers.sort();
		return allPeers;
	}
}

export class P2pStack {
	constructor(
		private readonly node: Libp2p<{
			identify: Identify;
			ping: PingService;
			dht: KadDHT;
		}>,
		private readonly server?: WebSocket,
	) {}

	public static async create(env: Env, connecting_ip: string, server?: WebSocket): Promise<P2pStack> {
		const node = await createLibp2p({
			privateKey: await generateKeyPairFromSeed('Ed25519', base64ToUint8Array(env.SECRET_KEY_SEED)),
			datastore: createDatastore(env.libp2p_on_edge),
			start: false,
			addresses: {
				listen: [env.WORKER_MULTIADDR],
			},
			transports: [
				webSockets({
					server,
					remoteAddr: connecting_ip,
					workerMultiaddr: env.WORKER_MULTIADDR,
				}),
			],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			peerDiscovery: [
				bootstrap({
					list: bootstrapMultiaddrs,
				}),
			],
			logger: {
				forComponent(name) {
					const debug = (...args: any[]) => console.log(name, ...args);
					return Object.assign(debug, {
						error: (...args: any[]) => console.error(name, ...args),
						trace: (...args: any[]) => console.trace(name, ...args),
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
		return new P2pStack(node, server);
	}

	public waitForStart(): Promise<void> {
		return new Promise((resolve) => {
			this.node.addEventListener('start', () => {
				resolve();
			});
		});
	}

	public async start(): Promise<void> {
		console.log('starting libp2p');
		this.node.addEventListener('peer:discovery', (evt) => {
			console.log('Discovered %s', evt.detail.id.toString()); // Log discovered peer
		});

		this.node.addEventListener('peer:connect', (evt) => {
			console.log('Connected to %s', evt.detail.toString()); // Log connected peer
		});
		this.node.start();
		console.log(`PeerID: ${this.node.peerId}`);
		console.log('libp2p has started');

		const stopFut = new Promise<void>((resolve) => {
			this.server?.addEventListener('close', async () => {
				console.log('closed');
				await this.node.stop();
				console.log('libp2p has stopped');
				resolve();
			});
			if (!this.server) {
				resolve();
			}
		});
		await stopFut;
	}

	public get kad(): KadHandler {
		return new KadHandler(this.node);
	}
}
