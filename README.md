# Libp2p on Edge

## What is this?

This is an implementation of a (js-)libp2p node running on [Cloudflare Workers](https://workers.cloudflare.com) and using [Cloudflare KV](https://www.cloudflare.com/developer-platform/products/workers-kv/) as the persistent datastore (peer-store and content-store).

## Why?

There are a couple of reasons I wanted to do this:

1. *libp2p in serverless environments*: I wanted to see if you could run libp2p in serverless environments, only starting when a connection is coming in.
2. *Building a better bootstrap node*: Since this node should be, thanks to Cloudflare, geographically close to users it could decrease access latency when bootstrapping a node. I see the greatest possibilities for improvement here.
3. *Increasing general KAD performance by encouraging connections to physically close nodes*: Although I don't do this yet I think Kademlias performance could be improved if the routing table would initially be filled with nodes that are geographically close to the bootstrapping node. I see queries that go around the world as a future/current performance bottleneck in DHT performance.
4. *Test limits and flexibility of js-libp2p*
5. *Build a comprehensive map of libp2p nodes*: Since Cloudflare provides [IP location information](https://blog.cloudflare.com/location-based-personalization-using-workers/) for every incoming request it would now be possible to map out where nodes are connecting from. This could give insights in possible (future) performance improvements.

## Does it work?

*Yes!*

At the time of writing you can access the node at `/dns/libp2p-on-edge.dione.network/tcp/443/wss/p2p/12D3KooWEEh437zVGirT8xqBo7WxBJvXTEucFZRp7hUsK55pp1tt`.

When you read this the PeerID might have changed but otherwise, this should be it.

There are also some API routes.

### Get value from Kademlia

```bash
# Get the Value (I assume UTF-8 encoded) for Hello
curl https://libp2p-on-edge.dione.network/api/v1/kad/hello
```

### Put value to Kademlia

```bash
# Put the Value "world" into Kademlia under the Key "hello"
curl --request PUT --data '{"value": "world"}' https://libp2p-on-edge.dione.network/api/v1/kad/hello
```

### Get closest peers to key

```bash
# Find the closest peers to the key "hello"
curl https://libp2p-on-edge.dione.network/api/v1/kad/closest/hello
```

## License

MIT License

Attribution to [js-libp2p](https://github.com/libp2p/js-libp2p) licensed under the MIT/Apache for the code of `@libp2p/websockets` which was modified to work in cloudflare workers.
