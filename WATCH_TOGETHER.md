# Watch together v2 client

The client connects to the sibling `anixweb-server` Cloudflare Worker through `VITE_ROOM_SERVER_URL` (default `http://localhost:8787`). Run that repository's local development setup first, then run `npm run dev` here. The Worker must allow the frontend origin through `ALLOWED_ORIGINS`; WebSocket connections also verify Origin.

RoomProvider lives above the router and owns one RoomClient per signed-in browser tab. Navigation between lobby, room management, release and player keeps the same connection. Membership and the private invitation code survive refresh in sessionStorage. Anixart tokens are used only to obtain an in-memory 15-minute room session; neither Anixart tokens nor room sessions enter WebSocket URLs. One-use connection tickets expire after 30 seconds.

RoomClient accepts validated revisioned snapshots, rejects outdated snapshots, waits for command acknowledgements, rejects outstanding commands on disconnection, and acquires a new ticket for each reconnect. Reconnect delays are 0.5/1/2/4 seconds with jitter. Replacement, kick and closure stop automatic reconnect; the replaced tab offers “Continue here”. A 5-second heartbeat and a 10-second initial snapshot timeout detect dead connections. Pending commands are never replayed.

The shared protocol is generated from the server source with `npm run sync:protocol`. Update the server contract first and synchronize before making interface changes. Run `node --test tests/roomClient.test.mjs` for transport regressions, plus the project's player, bridge and browser tests.

Rooms under the old protocol are not migrated. Create a new v2 room. Private invitations include `?code=...`; returning participants retain the invitation code in their tab's membership record. Opening a room no longer redirects into playback: its page retains member and host controls, and the player displays the same RoomPanel.
