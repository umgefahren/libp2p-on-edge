import {
	ComponentLogger,
	Connection,
	CreateListenerOptions,
	Listener,
	ListenerEvents,
	Logger,
	MultiaddrConnection,
	TypedEventEmitter,
} from '@libp2p/interface'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'

export interface WebSocketListenerComponents {
	logger: ComponentLogger
}
export interface WebSocketListenerInit extends CreateListenerOptions {
	server?: WebSocket
	remoteAddr: string
	workerMultiaddr: string
}

export class WsSource implements AsyncGenerator<Uint8Array> {
	constructor(private readonly socket: WebSocket) {}
	next(): Promise<IteratorResult<Uint8Array, void>> {
		return new Promise((resolve) => {
			this.socket.addEventListener('message', (event) => {
				resolve({
					value: new Uint8Array(event.data as ArrayBuffer),
					done: false,
				})
			})
		})
	}
	return(): Promise<IteratorResult<Uint8Array>> {
		return Promise.resolve({ value: new Uint8Array(), done: true })
	}
	throw<E>(e: E): Promise<IteratorResult<Uint8Array, E>> {
		return Promise.reject(e)
	}
	[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
		return this
	}
}

export class WsListener
	extends TypedEventEmitter<ListenerEvents>
	implements Listener
{
	private readonly myMultiaddr: Multiaddr
	private readonly remoteAddr: string
	private readonly remoteMultiaddr: Multiaddr
	private readonly server?: WebSocket
	private readonly log: Logger

	constructor(
		components: WebSocketListenerComponents,
		init: WebSocketListenerInit
	) {
		super()
		const { workerMultiaddr, remoteAddr, server } = init
		this.myMultiaddr = multiaddr(workerMultiaddr)
		this.remoteAddr = remoteAddr
		this.remoteMultiaddr = multiaddr(`/ip4/${remoteAddr}/tcp/0/ws`)
		this.server = server
		this.log = components.logger.forComponent('libp2p:websockets:listener')

		const self = this // eslint-disable-line @typescript-eslint/no-this-alias
		if (self.server) {
			const server = self.server
			const maConn: MultiaddrConnection = {
				close: function (): Promise<void> {
					server.close()
					return Promise.resolve()
				},
				abort: function (err: Error): void {
					console.error(err)
					server.close()
				},
				remoteAddr: this.remoteMultiaddr,
				timeline: {
					open: Date.now(),
				},
				log: this.log,
				source: new WsSource(server),
				sink: async (source) => {
					for await (const message of source) {
						server.send(message.slice())
					}
				},
			}
			try {
				init.upgrader
					.upgradeInbound(maConn)
					.then((conn) => {
						this.log(
							'inbound connection %s upgraded',
							this.remoteAddr
						)
						if (init?.handler != null) {
							init?.handler(conn)
						}

						this.dispatchEvent(
							new CustomEvent<Connection>('connection', {
								detail: conn,
							})
						)
					})
					.catch(async (err) => {
						this.log.error(
							'Inbound connection failed to upgrade',
							err
						)
						await maConn.close().catch((err) => {
							this.log.error(
								'inbound connection failed to close',
								err
							)
						})
					})
			} catch (err) {
				this.log.error('Inbound connection failed to upgrade', err)
				maConn.close().catch((err) => {
					this.log.error('inbound connection failed to close', err)
				})
			}
		}
	}
	getAddrs(): Multiaddr[] {
		return [this.myMultiaddr]
	}
	close(): Promise<void> {
		this.server?.close()
		return Promise.resolve()
	}

	listen(multiaddr: Multiaddr): Promise<void> {
		console.log('listening on', multiaddr)
		this.server?.accept()
		return Promise.resolve()
	}
}

export function createListener(
	components: WebSocketListenerComponents,
	init: WebSocketListenerInit
): Listener {
	return new WsListener(components, init)
}
