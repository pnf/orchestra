# Orchestra Piano

A collaborative real-time piano web application where multiple users can play music together.

## Features

- **Real-time multiplayer**: Share a room link and play piano together
- **Two-octave keyboard**: Playable via mouse/touch or computer keyboard
- **Sustain pedal**: Hold Shift to sustain notes for chords
- **User names**: Set your display name (saved in browser)
- **Location display**: See city/country for each player (based on IP geolocation)
- **Per-user volume**: Adjust volume for each remote player
- **Synchronized playback**: Configurable latency buffering for tighter timing across players
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

### Prerequisites

1. Install the Fly CLI:
   ```bash
   # macOS
   brew install flyctl

   # Linux
   curl -L https://fly.io/install.sh | sh

   # Windows
   iwr https://fly.io/install.ps1 -useb | iex
   ```

2. Create a Fly.io account and login:
   ```bash
   fly auth login
   ```

### Initial Setup

1. Create a new Fly app:
   ```bash
   fly apps create your-app-name
   ```

2. Ensure your `fly.toml` has the correct configuration:
   ```toml
   app = 'your-app-name'
   primary_region = 'sjc'  # Choose your preferred region

   [build]

   [env]
     PORT = '8080'

   [http_service]
     internal_port = 8080
     force_https = true
     auto_stop_machines = 'off'
     auto_start_machines = true
     min_machines_running = 1
     max_machines_running = 1

   [[vm]]
     memory = '512mb'
     cpu_kind = 'shared'
     cpus = 1
   ```

### Memory Requirements

⚠️ **Important**: This app uses `geoip-lite` for IP geolocation, which loads a ~140MB database into memory. The default Fly.io machine (256MB) is too small and will cause OOM (Out of Memory) errors.

**Required memory: 512MB minimum**

To set or update memory allocation:
```bash
fly scale memory 512
```

### Single Machine Requirement

Socket.io requires sticky sessions for WebSocket connections. This app runs on a single Fly.io machine to avoid load balancing issues.

**If you have multiple machines running**, scale down to one:
```bash
fly scale count 1
```

To scale beyond one machine in the future, you would need to add a Redis adapter for Socket.io session sharing.

### Deployment

Deploy your app:
```bash
fly deploy
```

The build process will:
1. Create a Docker container from the Dockerfile
2. Install Node.js dependencies (including geoip-lite)
3. Push the image to Fly's registry
4. Deploy to your machine

### Monitoring

View real-time logs:
```bash
fly logs
```

Check app status:
```bash
fly status
```

View machine details:
```bash
fly machine list
```

Monitor resource usage:
```bash
fly dashboard
```

### Troubleshooting

**App crashes with "Out of memory" errors:**
- Ensure memory is scaled to at least 512MB: `fly scale memory 512`
- Check current memory: `fly scale show`

**WebSocket connections failing:**
- Verify only 1 machine is running: `fly scale count 1`
- Check logs for connection errors: `fly logs`

**App not responding:**
- Restart the machine: `fly machine restart <machine-id>`
- Check machine status: `fly status`

**DNS/SSL issues:**
- Verify DNS: `fly ips list`
- Force HTTPS is enabled in fly.toml

### Useful Commands

```bash
# SSH into the running machine
fly ssh console

# Restart the app
fly apps restart

# View app details
fly info

# Open app in browser
fly open

# Destroy the app (careful!)
fly apps destroy your-app-name
```

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
