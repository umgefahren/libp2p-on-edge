import {
	transportSymbol,
	serviceCapabilities,
	ConnectionFailedError,
} from '@libp2p/interface'
import { multiaddrToUri as toUri } from '@multiformats/multiaddr-to-uri'
import { CustomProgressEvent } from 'progress-events'
import { raceSignal } from 'race-signal'
import { isBrowser, isWebWorker } from 'wherearewe'
import * as filters from './filters.js'
import { createListener, WsSource } from './listener.js'
import type {
	Transport,
	MultiaddrFilter,
	CreateListenerOptions,
	DialTransportOptions,
	Listener,
	AbortOptions,
	ComponentLogger,
	Logger,
	Connection,
	OutboundConnectionUpgradeEvents,
	Metrics,
	CounterGroup,
	MultiaddrConnection,
} from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { ProgressEvent } from 'progress-events'

export interface WebSocketsInit extends AbortOptions {
	filter?: MultiaddrFilter
	server?: WebSocket
	workerMultiaddr: string
	remoteAddr: string
	websocket?: {
		protocol: string
	}
}

export interface WebSocketsComponents {
	logger: ComponentLogger
	metrics?: Metrics
}

export interface WebSocketsMetrics {
	dialerEvents: CounterGroup
}

export type WebSocketsDialEvents =
	| OutboundConnectionUpgradeEvents
	| ProgressEvent<'websockets:open-connection'>

class WebSockets implements Transport<WebSocketsDialEvents> {
	private readonly log: Logger
	private readonly init: WebSocketsInit
	private readonly logger: ComponentLogger
	private readonly components: WebSocketsComponents

	constructor(components: WebSocketsComponents, init?: WebSocketsInit) {
		this.components = components
		this.log = this.components.logger.forComponent('libp2p:websockets')
		this.logger = this.components.logger
		if (init == null) {
			throw new Error('missing init options')
		}
		this.init = init
	}

	readonly [transportSymbol] = true

	readonly [Symbol.toStringTag] = '@libp2p/websockets'

	readonly [serviceCapabilities]: string[] = ['@libp2p/transport']

	async dial(
		ma: Multiaddr,
		options: DialTransportOptions<WebSocketsDialEvents>
	): Promise<Connection> {
		this.log('dialing %s', ma)
		options = options ?? {}
		const maConn = await createWebSocket(ma, this.init, this.log, options)
		this.log('new outbound connection %s', maConn.remoteAddr)

		const conn = await options.upgrader.upgradeOutbound(maConn, options)
		this.log('outbound connection %s upgraded', maConn.remoteAddr)
		return conn
	}

	/**
	 * Creates a Websockets listener. The provided `handler` function will be called
	 * anytime a new incoming Connection has been successfully upgraded via
	 * `upgrader.upgradeInbound`
	 */
	createListener(options: CreateListenerOptions): Listener {
		return createListener(
			{
				logger: this.logger,
			},
			{
				...this.init,
				...options,
			}
		)
	}

	/**
	 * Takes a list of `Multiaddr`s and returns only valid Websockets addresses.
	 * By default, in a browser environment only DNS+WSS multiaddr is accepted,
	 * while in a Node.js environment DNS+{WS, WSS} multiaddrs are accepted.
	 */
	listenFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
		multiaddrs = Array.isArray(multiaddrs) ? multiaddrs : [multiaddrs]

		if (this.init?.filter != null) {
			return this.init?.filter(multiaddrs)
		}

		// Browser
		if (isBrowser || isWebWorker) {
			return filters.wss(multiaddrs)
		}

		return filters.all(multiaddrs)
	}

	/**
	 * Filter check for all Multiaddrs that this transport can dial
	 */
	dialFilter(multiaddrs: Multiaddr[]): Multiaddr[] {
		return this.listenFilter(multiaddrs)
	}
}

async function createWebSocket(
	ma: Multiaddr,
	init: WebSocketsInit,
	logger: Logger,
	options: DialTransportOptions<WebSocketsDialEvents>
): Promise<MultiaddrConnection> {
	const uri = toUri(ma)

	const socket = new WebSocket(uri, init.websocket?.protocol)

	const source = new WsSource(socket)

	const errorPromise = new Promise((_resolve, reject) => {
		socket.addEventListener('error', () => {
			const err = new ConnectionFailedError(
				`Could not connect to ${ma.toString()}`
			)
			logger.error('connection error:', err)
			reject(err)
		})
	})

	const connectedPromise = new Promise<void>((resolve) => {
		socket.addEventListener('open', () => {
			resolve()
		})
	})

	try {
		options.onProgress?.(
			new CustomProgressEvent('websockets:open-connection')
		)
		await raceSignal(
			Promise.race([connectedPromise, errorPromise]),
			options.signal
		)
	} catch (err) {
		socket.close()

		throw err
	}

	return {
		sink: async (source) => {
			for await (const message of source) {
				socket.send(message.slice())
			}
		},
		source,
		close: async () => {
			if (
				socket.readyState === WebSocket.CONNECTING ||
				socket.readyState === WebSocket.OPEN
			) {
				await new Promise<void>((resolve) => {
					socket.addEventListener('close', () => {
						resolve()
					})
					socket.close()
				})
			}
		},
		abort: () => {
			socket.close()
		},
		remoteAddr: ma,
		timeline: {
			open: Date.now(),
		},
		log: logger,
	}
}

export function webSockets(
	init: WebSocketsInit
): (components: WebSocketsComponents) => Transport {
	return (components) => {
		return new WebSockets(components, init)
	}
}
