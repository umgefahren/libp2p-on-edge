import { BaseDatastore } from 'datastore-core'
import { Datastore, Key, KeyQuery, Pair, Query } from 'interface-datastore'
import { AbortOptions, AwaitIterable, NotFoundError } from 'interface-store'

export class CloudflareDatastore extends BaseDatastore {
	constructor(private readonly namespace: KVNamespace) {
		super()
	}

	override async has(key: Key): Promise<boolean> {
		const res = await this.namespace.get(key.toString())
		return res !== null
	}

	override async put(key: Key, val: Uint8Array): Promise<Key> {
		await this.namespace.put(key.toString(), val)
		return key
	}

	override async get(key: Key): Promise<Uint8Array> {
		const value = await this.namespace.get(key.toString(), 'arrayBuffer')
		if (value === null) {
			throw new NotFoundError('Not found')
		}
		return new Uint8Array(value)
	}

	override async delete(key: Key): Promise<void> {
		await this.namespace.delete(key.toString())
	}

	async getOffsetString(q: KeyQuery): Promise<string> {
		console.log('doing an offset string')
		let counter = 0
		let cursor = null
		while (true) {
			const { keys, list_complete } = await this.namespace.list({
				prefix: q.prefix,
				cursor,
			})
			if (list_complete) {
				throw new Error('offset is not in the list')
			}
			for (const key of keys) {
				if (counter === q.offset) {
					return key.name
				}
				cursor = key.name as string
				counter++
			}
		}
	}

	override _allKeys(q: KeyQuery, options?: AbortOptions): AwaitIterable<Key> {
		console.log('doing an all keys', options)
		const self = this // eslint-disable-line @typescript-eslint/no-this-alias
		return {
			[Symbol.asyncIterator]: async function* () {
				const offset = q.offset
					? await self.getOffsetString(q)
					: undefined
				const { keys } = await self.namespace.list({
					prefix: q.prefix,
					cursor: offset,
					limit: q.limit,
				})
				for (const key of keys) {
					if (options?.signal?.aborted) {
						break
					}
					yield new Key(key.name)
				}
			},
		}
	}

	override _all(q: Query, options?: AbortOptions): AwaitIterable<Pair> {
		console.log('doing an all', options)
		const self = this // eslint-disable-line @typescript-eslint/no-this-alias
		return {
			[Symbol.asyncIterator]: async function* () {
				const offset = q.offset
					? await self.getOffsetString({
							prefix: q.prefix,
							offset: q.offset,
						})
					: undefined
				const { keys } = await self.namespace.list({
					prefix: q.prefix,
					cursor: offset,
					limit: q.limit,
				})
				let consumed = 0
				for (const key of keys) {
					if (options?.signal?.aborted) {
						break
					}
					const value = await self.namespace.get(
						key.name,
						'arrayBuffer'
					)
					if (value === null) continue
					yield {
						key: new Key(key.name),
						value: new Uint8Array(value),
					}
					consumed++
					console.log('consumed', consumed)
				}
			},
		}
	}
}

export function createDatastore(namespace: KVNamespace): Datastore {
	return new CloudflareDatastore(namespace)
}
