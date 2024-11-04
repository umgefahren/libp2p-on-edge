import { BaseDatastore } from 'datastore-core';
import { Datastore, Key, KeyQuery, Pair, Query } from 'interface-datastore';
import { AbortOptions, AwaitIterable, NotFoundError } from 'interface-store';

export class CloudflareDatastore extends BaseDatastore {
	constructor(private readonly namespace: KVNamespace) {
		super();
	}

	override async has(key: Key, _options?: AbortOptions): Promise<boolean> {
		const res = await this.namespace.get(key.toString());
		return res !== null;
	}

	override async put(key: Key, val: Uint8Array, _options?: AbortOptions): Promise<Key> {
		await this.namespace.put(key.toString(), val);
		return key;
	}

	override async get(key: Key, _options?: AbortOptions): Promise<Uint8Array> {
		const value = await this.namespace.get(key.toString(), 'arrayBuffer');
		if (value === null) {
			throw new NotFoundError('Not found');
		}
		return new Uint8Array(value);
	}

	override async delete(key: Key, _options?: AbortOptions): Promise<void> {
		await this.namespace.delete(key.toString());
	}

	async getOffsetString(q: KeyQuery): Promise<string> {
		let counter = 0;
		let cursor = null;
		while (true) {
			const { keys, list_complete } = await this.namespace.list({ prefix: q.prefix, cursor });
			if (list_complete) {
				throw new Error('offset is not in the list');
			}
			for (const key of keys) {
				if (counter === q.offset) {
					return key.name;
				}
				cursor = key.name as string;
				counter++;
			}
		}
	}

	override _allKeys(q: KeyQuery, _options?: AbortOptions): AwaitIterable<Key> {
		const self = this;
		return {
			[Symbol.asyncIterator]: async function* () {
				const offset = q.offset ? await self.getOffsetString(q) : undefined;
				const { keys } = await self.namespace.list({ prefix: q.prefix, cursor: offset, limit: q.limit });
				for (const key of keys) {
					yield new Key(key.name);
				}
			},
		};
	}

	override _all(q: Query, _options?: AbortOptions): AwaitIterable<Pair> {
		const self = this;
		return {
			[Symbol.asyncIterator]: async function* () {
				const offset = q.offset ? await self.getOffsetString(q) : undefined;
				const { keys } = await self.namespace.list({ prefix: q.prefix, cursor: offset, limit: q.limit });
				for (const key of keys) {
					const value = await self.namespace.get(key.name, 'arrayBuffer');
					if (value === null) continue;
					yield { key: new Key(key.name), value: new Uint8Array(value) };
				}
			},
		};
	}
}

export function createDatastore(namespace: KVNamespace): Datastore {
	return new CloudflareDatastore(namespace);
}
