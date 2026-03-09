# FreqLink

Terminal-based encrypted messaging over frequency-based channels.

FreqLink is a peer-to-peer encrypted chat system that runs in your terminal. Peers join numeric "frequencies" (e.g., `145.80`) and exchange end-to-end encrypted messages. The relay server never sees plaintext — all encryption and decryption happens client-side.

## Quick Start

You need Node.js >= 18. No installation required — just run:

```bash
npx freqlink
```

A public relay is already running. You and your peer both run the command above, join the same frequency, and start communicating.

### Example session

```
> /connect
  ✓ Connected to relay node

> /join 145.80 --key NIGHTFALL
  Joined frequency 145.80 MHz

> Hello
[falcon-node]: Hello

> /burn Eyes only — coordinates 51.5074,-0.1278
  ⚠ BURN message sent (TTL: 5s)

> /quit
  Session terminated. Keys purged.
```

## Commands

| Command | Description |
|---|---|
| `/connect` | Connect to the relay server |
| `/join <freq> --key <secret>` | Join a frequency with a passphrase (required) |
| `/leave` | Leave the current frequency |
| `/peers` | List peers on the current frequency |
| `/dm <peer> <message>` | Send an encrypted direct message |
| `/burn <message>` | Send a self-destructing message (default 5s TTL) |
| `/burn <message> --ttl <s>` | Send a burn message with custom TTL (1–30 seconds) |
| `/quit` | Disconnect and purge all session keys from memory |
| `/help` | Show available commands |

Any input not starting with `/` is broadcast to all peers on the frequency.

## Frequency Format

Frequencies use the format `NNN.NN` (e.g., `145.80`, `001.00`, `999.99`). Frequencies are never discoverable — coordinate them out-of-band with your peer.

## Self-hosting

The relay server is deployed at `wss://freqlink.onrender.com` by default. To run your own:

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/freqlink.git
cd freqlink
npm install

# Start relay server
node server/index.js

# In another terminal, connect to it
FREQLINK_SERVER=ws://localhost:3200 node cli/index.js
```

### Deploy to Render

Push to GitHub, create a new Web Service on [render.com](https://render.com), connect the repo, and set:

- **Start command:** `node server/index.js`
- **Health check path:** `/health`

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3200` | Server listen port |
| `MAX_PEERS_PER_FREQ` | `50` | Maximum peers per frequency |
| `FREQLINK_SERVER` | `wss://freqlink.onrender.com` | Relay server URL (client) |

## Encryption

- **X25519 ECDH** — ephemeral key pair per session; shared secret computed on join
- **HKDF-SHA256** — derives session key from ECDH shared secret + frequency
- **AES-256-GCM** — encrypts every message with a unique 12-byte random IV
- **scrypt** — derives an additional key from `--key` passphrase; XOR-combined with session key via HKDF
- **Zero-knowledge verification** — HMAC-SHA256 challenge confirms shared passphrase without revealing it (`✓` / `⚠` per peer)
- **Memory hygiene** — all key material is zeroed on `/leave` and `/quit`

The relay server is a dumb router. It never reads, stores, or logs message contents.

## Project Structure

```
freqlink/
├── cli/
│   ├── index.js         # Entry point and REPL
│   ├── commands.js      # Command parser and dispatcher
│   ├── connection.js    # WebSocket client with reconnection
│   ├── state.js         # Session state and key management
│   └── ui.js            # Terminal rendering and formatting
├── crypto/
│   ├── encryption.js    # AES-256-GCM encrypt/decrypt
│   ├── keyDerivation.js # HKDF and scrypt key derivation
│   ├── keyExchange.js   # X25519 ECDH key exchange
│   └── utils.js         # Crypto utilities and helpers
├── server/
│   ├── index.js         # Relay server entry point
│   ├── heartbeat.js     # WebSocket keepalive monitor
│   ├── rateLimiter.js   # Sliding-window rate limiter
│   ├── relay.js         # In-memory frequency routing
│   └── validation.js    # Server-side input validation
└── shared/
    ├── constants.js     # Protocol limits and defaults
    └── protocol.js      # Message types and serialization
```
