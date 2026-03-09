# FreqLink

Terminal-based encrypted messaging over frequency-based channels.

FreqLink is a peer-to-peer encrypted chat system that runs entirely in the terminal. Peers join named "frequencies" (e.g., `145.80`) and exchange end-to-end encrypted messages. The relay server never sees plaintext — all encryption and decryption happens client-side.

## Features

- **End-to-end encryption** — AES-256-GCM with ephemeral X25519 ECDH key exchange per session
- **Optional passphrase layer** — combine ECDH with scrypt-derived passphrase keys for defense-in-depth
- **Zero-knowledge key verification** — HMAC-SHA256 challenge/response confirms shared passphrase without revealing it
- **Burn messages** — self-destructing messages that erase from the terminal after a configurable TTL
- **Direct messages** — encrypted DMs to specific peers on the same frequency
- **Rate limiting** — sliding-window rate limits prevent abuse
- **Heartbeat keepalives** — automatic dead connection detection and cleanup
- **Reconnection** — exponential backoff reconnection with up to 5 attempts
- **Memory hygiene** — all key material is zeroed when leaving a frequency or quitting

## Requirements

- Node.js >= 18.0.0
- npm

## Installation

```bash
cd freqlink
npm install
```

## Usage

### Start the relay server

```bash
npm run server
# or
node server/index.js
```

The server starts on port `3200` by default. Set the `PORT` environment variable to override:

```bash
PORT=8080 node server/index.js
```

A health check endpoint is available at `http://localhost:3200/health`.

### Start a client

In a separate terminal:

```bash
node cli/index.js
```

You will be prompted for a peer name (alphanumeric + hyphens, max 32 characters).

To connect to a non-default server:

```bash
FREQLINK_SERVER=ws://example.com:3200 node cli/index.js
```

## Commands

| Command | Description |
|---|---|
| `/connect` | Connect to the relay server |
| `/join <freq>` | Join a frequency (e.g., `/join 145.80`) |
| `/join <freq> --key <secret>` | Join with a passphrase for layered encryption |
| `/leave` | Leave the current frequency |
| `/peers` | List peers on the current frequency |
| `/dm <peer> <message>` | Send an encrypted direct message |
| `/burn <message>` | Send a self-destructing message (default 5s TTL) |
| `/burn <message> --ttl <s>` | Send a burn message with custom TTL (1–30 seconds) |
| `/quit` | Disconnect and purge all session keys from memory |
| `/help` | Show available commands |

Any input not starting with `/` is sent as a broadcast message to all peers on the frequency.

## Frequency Format

Frequencies use the format `NNN.NN` (e.g., `145.80`, `001.00`, `999.99`). Both the frequency value and format are validated on the client and server.

## Encryption Architecture

### Key Exchange

1. On `/join`, each client generates an ephemeral X25519 key pair.
2. The public key is sent to the server with the join message.
3. The server sends the joining peer a list of existing peers and their public keys.
4. Each peer computes an ECDH shared secret, then derives a 32-byte session key via HKDF-SHA256.
5. If a passphrase was provided with `--key`, a second key is derived via scrypt and XOR-combined with the ECDH key through a second HKDF pass.

### Message Encryption

Each message is encrypted with AES-256-GCM:
- A fresh 12-byte random IV is generated per message.
- The payload layout is: `[IV (12 bytes)][authTag (16 bytes)][ciphertext]`.
- The entire payload is base64-encoded before transmission.

### Key Verification

When both peers use `--key`, a zero-knowledge HMAC challenge confirms they share the same passphrase without revealing it. Verified peers are shown with a green checkmark (`✓`); mismatched peers show a yellow warning (`⚠`).

## Security Notes

- The relay server is a dumb router — it never reads, stores, or logs message contents.
- Session keys exist only in memory and are zeroed (`Buffer.fill(0)`) on `/leave` and `/quit`.
- ANSI escape sequences are stripped from all decrypted messages to prevent terminal injection.
- All user input is validated on both client and server before processing.
- Rate limiting prevents message flooding (30 messages per 10 seconds, 5 join/leave per 30 seconds).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3200` | Server listen port |
| `MAX_PEERS_PER_FREQ` | `50` | Maximum peers per frequency |
| `FREQLINK_SERVER` | `ws://localhost:3200` | Client relay server URL |

## Project Structure

```
freqlink/
├── cli/
│   ├── index.js       # CLI entry point and REPL
│   ├── commands.js    # Command parser and dispatcher
│   ├── connection.js  # WebSocket client with reconnection
│   ├── state.js       # Session state management
│   └── ui.js          # Terminal rendering and formatting
├── crypto/
│   ├── encryption.js  # AES-256-GCM encrypt/decrypt
│   ├── keyDerivation.js # HKDF and scrypt key derivation
│   ├── keyExchange.js # X25519 ECDH key exchange
│   └── utils.js       # Crypto utilities and helpers
├── server/
│   ├── index.js       # Relay server entry point
│   ├── heartbeat.js   # WebSocket keepalive monitor
│   ├── rateLimiter.js # Sliding-window rate limiter
│   ├── relay.js       # In-memory frequency routing
│   └── validation.js  # Server-side input validation
├── shared/
│   ├── constants.js   # Protocol limits and defaults
│   └── protocol.js    # Message types and serialization
└── package.json
```
