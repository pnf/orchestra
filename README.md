# Orchestra Piano

A collaborative real-time piano web application where multiple users can play music together.

## Features

- **Real-time multiplayer**: Share a room link and play piano together
- **Two-octave keyboard**: Playable via mouse/touch or computer keyboard
- **Sustain pedal**: Hold Shift to sustain notes for chords
- **User names**: Set your display name (saved in browser)
- **Per-user volume**: Adjust volume for each remote player
- **Visual feedback**: See which keys other users are playing (highlighted in blue)

## Keyboard Layout

The keyboard maps two octaves across the bottom rows of a QWERTY keyboard:

**Lower octave (C3-E4):**
```
Black keys:  S   D       G   H   J       L   ;
White keys: Z   X   C   V   B   N   M   ,   .   /
Notes:      C3  D3  E3  F3  G3  A3  B3  C4  D4  E4
```

**Upper octave (C4-G5):**
```
Black keys:  2   3       5   6   7       9   0       =
White keys: Q   W   E   R   T   Y   U   I   O   P   [   ]
Notes:      C4  D4  E4  F4  G4  A4  B4  C5  D5  E5  F5  G5
```

**Sustain:** Hold `Shift` to keep notes ringing

## Usage

1. Visit the app URL - you'll be redirected to a unique room
2. Share the URL with others to play together
3. Click/tap the piano or use keyboard shortcuts to play
4. Set your name in the input field (top left)
5. Adjust remote player volumes using the sliders below the piano

## Technical Architecture

- **Frontend**: Vanilla JavaScript with Tone.js for audio synthesis
- **Audio**: Salamander Grand Piano samples via Tone.js Sampler
- **Backend**: Node.js + Express + Socket.io
- **Real-time**: WebSocket connections for low-latency note sharing
- **Hosting**: Fly.io (single machine to avoid WebSocket load balancing issues)

### How it works

1. Client loads and initializes Tone.js with piano samples
2. On first user interaction, audio context is started (required by browsers)
3. Client connects via Socket.io and joins the room from the URL path
4. Note events (noteOn/noteOff) are broadcast to all users in the room
5. Each client plays received notes locally with per-user volume control

## Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Visit http://localhost:8080
```

## Deployment to Fly.io

```bash
# Install Fly CLI
brew install flyctl

# Login to Fly
fly auth login

# Create app (first time only)
fly apps create orchestra-piano

# Deploy
fly deploy

# View logs
fly logs
```

### Important: Single Machine Requirement

Socket.io requires sticky sessions or shared state across machines. For simplicity, this app runs on a single Fly.io machine:

```toml
# fly.toml
[http_service]
  min_machines_running = 1
  max_machines_running = 1
```

To scale beyond one machine, add a Redis adapter for Socket.io.

## Limitations

- **Latency**: Internet latency (50-200ms) means this works best for ambient/slow music rather than tight rhythmic playing
- **Audio on mobile**: iOS requires a user tap before audio can play - tap the piano to start

## Project Structure

```
orchestra/
├── server/
│   └── index.js        # Express + Socket.io server
├── public/
│   ├── index.html      # Main HTML page
│   ├── app.js          # Client-side piano and socket logic
│   └── style.css       # Styling
├── package.json
├── Dockerfile
├── fly.toml            # Fly.io configuration
└── README.md
```

## License

MIT
