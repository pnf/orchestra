// Piano configuration - three octaves (C3 to G5)
const NOTES = [
  // Octave 1 (C3 to B3)
  { note: 'C3', type: 'white' },
  { note: 'C#3', type: 'black' },
  { note: 'D3', type: 'white' },
  { note: 'D#3', type: 'black' },
  { note: 'E3', type: 'white' },
  { note: 'F3', type: 'white' },
  { note: 'F#3', type: 'black' },
  { note: 'G3', type: 'white' },
  { note: 'G#3', type: 'black' },
  { note: 'A3', type: 'white' },
  { note: 'A#3', type: 'black' },
  { note: 'B3', type: 'white' },
  // Octave 2 (C4 to B4) - Middle C octave
  { note: 'C4', type: 'white' },
  { note: 'C#4', type: 'black' },
  { note: 'D4', type: 'white' },
  { note: 'D#4', type: 'black' },
  { note: 'E4', type: 'white' },
  { note: 'F4', type: 'white' },
  { note: 'F#4', type: 'black' },
  { note: 'G4', type: 'white' },
  { note: 'G#4', type: 'black' },
  { note: 'A4', type: 'white' },
  { note: 'A#4', type: 'black' },
  { note: 'B4', type: 'white' },
  // Octave 3 (C5 to G5)
  { note: 'C5', type: 'white' },
  { note: 'C#5', type: 'black' },
  { note: 'D5', type: 'white' },
  { note: 'D#5', type: 'black' },
  { note: 'E5', type: 'white' },
  { note: 'F5', type: 'white' },
  { note: 'F#5', type: 'black' },
  { note: 'G5', type: 'white' },
];

// Keyboard mapping - overlapping octaves
const KEY_MAP = {
  // Lower octave - white keys (bottom row: Z to /)
  'z': 'C3', 'x': 'D3', 'c': 'E3', 'v': 'F3', 'b': 'G3', 'n': 'A3', 'm': 'B3',
  ',': 'C4', '.': 'D4', '/': 'E4',
  // Lower octave - black keys (second row)
  's': 'C#3', 'd': 'D#3', 'g': 'F#3', 'h': 'G#3', 'j': 'A#3', 'l': 'C#4', ';': 'D#4',
  // Upper octave - white keys (third row: Q to ])
  'q': 'C4', 'w': 'D4', 'e': 'E4', 'r': 'F4', 't': 'G4', 'y': 'A4', 'u': 'B4',
  'i': 'C5', 'o': 'D5', 'p': 'E5', '[': 'F5', ']': 'G5',
  // Upper octave - black keys (fourth row)
  '2': 'C#4', '3': 'D#4', '5': 'F#4', '6': 'G#4', '7': 'A#4',
  '9': 'C#5', '0': 'D#5', '=': 'F#5',
};

// Get or create persistent client ID
function getClientId() {
  let clientId = localStorage.getItem('orchestra-client-id');
  if (!clientId) {
    clientId = 'client-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('orchestra-client-id', clientId);
  }
  return clientId;
}

// State
let sampler = null;
let socket = null;
let myUserId = null;
let myClientId = getClientId();
let sustainActive = false;
let sustainedNotes = new Set();
let activeKeys = new Set();
let remoteActiveNotes = new Map(); // note -> Set of userIds
let users = []; // List of users in the room
let userVolumes = new Map(); // userId -> volume (0-1)
let playingUsers = new Set(); // Set of userIds currently playing

// Time sync state
let serverTimeOffset = 0; // local time - server time (positive = local is ahead)
let syncLatency = 200; // ms to delay all playback for synchronization
let syncEnabled = true; // whether to use synchronized playback

// DOM elements
const pianoEl = document.getElementById('piano');
const loadingEl = document.getElementById('loading');
const shareUrlEl = document.getElementById('shareUrl');
const copyBtnEl = document.getElementById('copyBtn');
const userNameEl = document.getElementById('userName');
const userListEl = document.getElementById('userList');
const syncLatencyEl = document.getElementById('syncLatency');
const syncLatencyValueEl = document.getElementById('syncLatencyValue');
const syncEnabledEl = document.getElementById('syncEnabled');

// Initialize
async function init() {
  buildPiano();
  setupKeyboardListeners();
  setupShareLink();
  setupNameInput();
  setupSyncControls();
  await initAudio();
  connectSocket();
}

// Setup sync controls - settings are shared across room
function setupSyncControls() {
  // Initialize UI with defaults (will be updated when roomSettings arrives)
  if (syncLatencyEl) {
    syncLatencyEl.value = syncLatency;
    syncLatencyValueEl.textContent = syncLatency + 'ms';

    // Debounce latency changes to avoid spamming server
    let latencyTimeout = null;
    syncLatencyEl.addEventListener('input', () => {
      syncLatency = parseInt(syncLatencyEl.value);
      syncLatencyValueEl.textContent = syncLatency + 'ms';

      // Broadcast to room after short delay
      clearTimeout(latencyTimeout);
      latencyTimeout = setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit('setSyncLatency', syncLatency);
        }
      }, 100);
    });
  }

  if (syncEnabledEl) {
    syncEnabledEl.checked = syncEnabled;

    syncEnabledEl.addEventListener('change', () => {
      syncEnabled = syncEnabledEl.checked;
      if (socket && socket.connected) {
        socket.emit('setSyncEnabled', syncEnabled);
      }
    });
  }
}

// Update UI when room settings are received from server
function applyRoomSettings(settings) {
  syncLatency = settings.syncLatency;
  syncEnabled = settings.syncEnabled;

  if (syncLatencyEl) {
    syncLatencyEl.value = syncLatency;
    syncLatencyValueEl.textContent = syncLatency + 'ms';
  }

  if (syncEnabledEl) {
    syncEnabledEl.checked = syncEnabled;
  }

  console.log(`Room settings applied: latency=${syncLatency}ms, enabled=${syncEnabled}`);
}

// Sync time with server (average multiple pings for accuracy)
async function syncTimeWithServer() {
  if (!socket || !socket.connected) return;

  const samples = [];
  const numSamples = 5;

  for (let i = 0; i < numSamples; i++) {
    const offset = await measureTimeOffset();
    if (offset !== null) {
      samples.push(offset);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  if (samples.length > 0) {
    // Use median to avoid outliers
    samples.sort((a, b) => a - b);
    serverTimeOffset = samples[Math.floor(samples.length / 2)];
    console.log(`Time sync: offset = ${serverTimeOffset}ms (${samples.length} samples)`);
  }
}

// Measure single time offset
function measureTimeOffset() {
  return new Promise((resolve) => {
    const clientSendTime = Date.now();
    socket.emit('timeSync', clientSendTime, (response) => {
      const clientReceiveTime = Date.now();
      const roundTrip = clientReceiveTime - clientSendTime;
      // Estimate server time at midpoint of round trip
      const estimatedServerTime = response.serverTime + roundTrip / 2;
      const offset = clientReceiveTime - estimatedServerTime;
      resolve(offset);
    });
  });
}

// Convert server timestamp to local scheduled time
function serverTimeToLocal(serverTime) {
  return serverTime + serverTimeOffset + syncLatency;
}

// Schedule a function to run at a specific local time
function scheduleAt(localTime, fn) {
  const delay = localTime - Date.now();
  if (delay <= 0) {
    fn();
  } else {
    setTimeout(fn, delay);
  }
}

// Build piano keyboard
function buildPiano() {
  NOTES.forEach(({ note, type }) => {
    const key = document.createElement('div');
    key.className = `key ${type}`;
    key.dataset.note = note;

    // Add keyboard shortcut labels
    const shortcuts = Object.entries(KEY_MAP).filter(([k, n]) => n === note);
    if (shortcuts.length > 0) {
      const label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = shortcuts.slice(0, 2).map(([k]) => k.toUpperCase()).join('/');
      key.appendChild(label);
    }

    // Mouse events
    key.addEventListener('mousedown', () => startNote(note));
    key.addEventListener('mouseup', () => endNote(note));
    key.addEventListener('mouseleave', () => endNote(note));

    // Touch events
    key.addEventListener('touchstart', (e) => { e.preventDefault(); startNote(note); }, { passive: false });
    key.addEventListener('touchend', (e) => { e.preventDefault(); endNote(note); }, { passive: false });
    key.addEventListener('touchcancel', (e) => { e.preventDefault(); endNote(note); }, { passive: false });

    pianoEl.appendChild(key);
  });
}

// Initialize audio with Tone.js
async function initAudio() {
  const baseUrl = 'https://tonejs.github.io/audio/salamander/';

  sampler = new Tone.Sampler({
    urls: {
      'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', 'A3': 'A3.mp3',
      'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', 'A4': 'A4.mp3',
      'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
    },
    baseUrl: baseUrl,
    release: 1,
    onload: () => {
      loadingEl.classList.add('hidden');
      console.log('Piano samples loaded');
    }
  }).toDestination();

  // Start audio context on user interaction (iOS requirement)
  let audioStarted = false;
  const startAudio = () => {
    if (!audioStarted && Tone.context.state !== 'running') {
      Tone.start().then(() => {
        audioStarted = true;
        console.log('Audio context started');
        document.body.style.borderTop = '3px solid green';
      }).catch(err => {
        console.error('Failed to start audio:', err);
        document.body.style.borderTop = '3px solid red';
      });
    }
  };
  document.addEventListener('click', startAudio);
  document.addEventListener('keydown', startAudio);
  document.addEventListener('touchstart', startAudio);
  document.addEventListener('touchend', startAudio);
}

// Setup name input
function setupNameInput() {
  // Load saved name from localStorage
  const savedName = localStorage.getItem('orchestra-name');
  if (savedName) {
    userNameEl.value = savedName;
  }

  // Send name changes to server
  let nameTimeout = null;
  userNameEl.addEventListener('input', () => {
    const name = userNameEl.value.trim() || 'Anonymous';
    localStorage.setItem('orchestra-name', name);

    // Update local user list immediately for responsive feedback
    const myUser = users.find(u => u.id === myUserId);
    if (myUser) {
      myUser.name = name;
      renderUserList();
    }

    // Debounce server update to avoid spamming
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(() => {
      if (socket && socket.connected) {
        socket.emit('setName', name);
      }
    }, 300);
  });
}

// Get user volume (default 1.0)
function getUserVolume(userId) {
  return userVolumes.get(userId) ?? 1.0;
}

// Set user volume
function setUserVolume(userId, volume) {
  userVolumes.set(userId, volume);
}

// Start playing a note
function startNote(note, isRemote = false, remoteUserId = null, timestamp = null) {
  if (!isRemote && activeKeys.has(note)) return;

  const keyEl = pianoEl.querySelector(`[data-note="${note}"]`);

  if (isRemote) {
    if (!remoteActiveNotes.has(note)) {
      remoteActiveNotes.set(note, new Set());
    }
    remoteActiveNotes.get(note).add(remoteUserId);

    // Schedule visual feedback to match audio timing
    if (syncEnabled && timestamp) {
      scheduleAt(serverTimeToLocal(timestamp), () => {
        keyEl?.classList.add('remote');
        setUserPlaying(remoteUserId, true);
      });
    } else {
      keyEl?.classList.add('remote');
      setUserPlaying(remoteUserId, true);
    }
  } else {
    activeKeys.add(note);

    if (socket && socket.connected) {
      socket.emit('noteOn', { note, velocity: 0.8 });
    }

    // In sync mode, don't show visual or play locally - wait for server echo
    if (syncEnabled) {
      return;
    }

    keyEl?.classList.add('active');
  }

  // Play sound (possibly scheduled)
  playNoteSound(note, isRemote ? getUserVolume(remoteUserId) : 1.0, timestamp);
}

// Play the actual sound, optionally scheduled
function playNoteSound(note, volume, timestamp = null) {
  if (!sampler || Tone.context.state !== 'running') return;

  if (syncEnabled && timestamp) {
    const playTime = serverTimeToLocal(timestamp);
    scheduleAt(playTime, () => {
      sampler.triggerAttack(note, Tone.now(), 0.8 * volume);
    });
  } else {
    sampler.triggerAttack(note, Tone.now(), 0.8 * volume);
  }
}

// Stop playing a note
function endNote(note, isRemote = false, remoteUserId = null, timestamp = null) {
  const keyEl = pianoEl.querySelector(`[data-note="${note}"]`);

  if (isRemote) {
    if (remoteActiveNotes.has(note)) {
      remoteActiveNotes.get(note).delete(remoteUserId);
      if (remoteActiveNotes.get(note).size === 0) {
        remoteActiveNotes.delete(note);

        // Schedule visual feedback removal to match audio timing
        if (syncEnabled && timestamp) {
          scheduleAt(serverTimeToLocal(timestamp), () => {
            keyEl?.classList.remove('remote');
          });
        } else {
          keyEl?.classList.remove('remote');
        }

        if (!activeKeys.has(note) && !sustainedNotes.has(note)) {
          releaseNoteSound(note, timestamp);
        }
      }
    }

    // Check if user is still playing any notes (also schedule this check when synced)
    const checkStillPlaying = () => {
      let stillPlaying = false;
      remoteActiveNotes.forEach((users) => {
        if (users.has(remoteUserId)) stillPlaying = true;
      });
      if (!stillPlaying) {
        setUserPlaying(remoteUserId, false);
      }
    };

    if (syncEnabled && timestamp) {
      scheduleAt(serverTimeToLocal(timestamp), checkStillPlaying);
    } else {
      checkStillPlaying();
    }
  } else {
    activeKeys.delete(note);

    if (sustainActive) {
      sustainedNotes.add(note);
    } else {
      keyEl?.classList.remove('active');

      if (socket && socket.connected) {
        socket.emit('noteOff', { note });
      }

      // In sync mode, don't release locally - wait for server echo
      if (syncEnabled) {
        return;
      }

      if (!remoteActiveNotes.has(note)) {
        sampler?.triggerRelease(note);
      }
    }
  }
}

// Release note sound, optionally scheduled
function releaseNoteSound(note, timestamp = null) {
  if (!sampler) return;

  if (syncEnabled && timestamp) {
    const playTime = serverTimeToLocal(timestamp);
    scheduleAt(playTime, () => {
      sampler.triggerRelease(note);
    });
  } else {
    sampler.triggerRelease(note);
  }
}

// Release all sustained notes
function releaseSustain() {
  sustainedNotes.forEach(note => {
    const keyEl = pianoEl.querySelector(`[data-note="${note}"]`);
    keyEl?.classList.remove('active');

    if (!remoteActiveNotes.has(note)) {
      sampler?.triggerRelease(note);
    }

    if (socket && socket.connected) {
      socket.emit('noteOff', { note });
    }
  });
  sustainedNotes.clear();
}

// Keyboard event handlers
function setupKeyboardListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.key === 'Shift' && !sustainActive) {
      sustainActive = true;
      document.body.classList.add('sustain-active');
      return;
    }

    const note = KEY_MAP[e.key.toLowerCase()];
    if (note && !e.repeat) {
      startNote(note);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      sustainActive = false;
      document.body.classList.remove('sustain-active');
      releaseSustain();
      return;
    }

    const note = KEY_MAP[e.key.toLowerCase()];
    if (note) {
      endNote(note);
    }
  });
}

// Setup share link
function setupShareLink() {
  shareUrlEl.value = window.location.href;

  copyBtnEl.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyBtnEl.textContent = 'Copied!';
      setTimeout(() => { copyBtnEl.textContent = 'Copy'; }, 2000);
    } catch (err) {
      shareUrlEl.select();
      document.execCommand('copy');
    }
  });
}

// Render user list
function renderUserList() {
  userListEl.innerHTML = '';

  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'user-item';
    li.dataset.userId = user.id;

    if (user.id === myUserId) {
      li.classList.add('is-me');
    }

    if (playingUsers.has(user.id)) {
      li.classList.add('playing');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';

    // Build display name with location
    let displayText = user.name + (user.id === myUserId ? ' (you)' : '');
    if (user.location) {
      displayText += ` • ${user.location}`;
    }
    nameSpan.textContent = displayText;

    li.appendChild(nameSpan);

    // Add volume slider for other users
    if (user.id !== myUserId) {
      const volumeControl = document.createElement('div');
      volumeControl.className = 'volume-control';

      const volumeLabel = document.createElement('label');
      volumeLabel.textContent = 'Vol';

      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.className = 'volume-slider';
      volumeSlider.min = '0';
      volumeSlider.max = '100';
      volumeSlider.value = (getUserVolume(user.id) * 100).toString();

      volumeSlider.addEventListener('input', () => {
        setUserVolume(user.id, parseInt(volumeSlider.value) / 100);
      });

      volumeControl.appendChild(volumeLabel);
      volumeControl.appendChild(volumeSlider);
      li.appendChild(volumeControl);
    }

    userListEl.appendChild(li);
  });
}

// Set user playing state and update UI
function setUserPlaying(userId, isPlaying) {
  if (isPlaying) {
    playingUsers.add(userId);
  } else {
    playingUsers.delete(userId);
  }

  // Update UI
  const userItem = userListEl.querySelector(`[data-user-id="${userId}"]`);
  if (userItem) {
    if (isPlaying) {
      userItem.classList.add('playing');
    } else {
      userItem.classList.remove('playing');
    }
  }
}

// Clean up all notes from a specific remote user
function cleanupUserNotes(userId) {
  remoteActiveNotes.forEach((userSet, note) => {
    if (userSet.has(userId)) {
      userSet.delete(userId);
      if (userSet.size === 0) {
        remoteActiveNotes.delete(note);
        const keyEl = pianoEl.querySelector(`[data-note="${note}"]`);
        keyEl?.classList.remove('remote');
        if (!activeKeys.has(note) && !sustainedNotes.has(note)) {
          sampler?.triggerRelease(note);
        }
      }
    }
  });
  setUserPlaying(userId, false);
}

// Release all local notes (for visibility change)
function releaseAllLocalNotes() {
  activeKeys.forEach(note => {
    endNote(note);
  });
  if (sustainActive) {
    sustainActive = false;
    document.body.classList.remove('sustain-active');
    releaseSustain();
  }
}

// Connect to Socket.io
function connectSocket() {
  const roomId = window.location.pathname.slice(1);

  socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  function joinRoom() {
    const name = userNameEl.value.trim() || 'Anonymous';
    console.log(`Connected to server, joining room: "${roomId}" as "${name}" (clientId: ${myClientId})`);
    socket.emit('join', { roomId, name, clientId: myClientId });
  }

  socket.on('connect', () => {
    joinRoom();
    // Sync time with server
    syncTimeWithServer();
  });

  socket.on('yourId', (id) => {
    myUserId = id;
    console.log('My user ID:', myUserId);
    // Re-render user list to show "(you)" correctly
    renderUserList();
  });

  socket.on('userList', (userList) => {
    users = userList;
    renderUserList();
  });

  // Room-level sync settings (shared across all users)
  socket.on('roomSettings', (settings) => {
    applyRoomSettings(settings);
  });

  // Remote user note events
  socket.on('noteOn', (data) => {
    startNote(data.note, true, data.userId, data.timestamp);
  });

  socket.on('noteOff', (data) => {
    endNote(data.note, true, data.userId, data.timestamp);
  });

  // Local note echoes (for synchronized playback)
  socket.on('noteOnSelf', (data) => {
    if (syncEnabled) {
      const keyEl = pianoEl.querySelector(`[data-note="${data.note}"]`);
      // Schedule both visual and audio together
      scheduleAt(serverTimeToLocal(data.timestamp), () => {
        keyEl?.classList.add('active');
        if (sampler && Tone.context.state === 'running') {
          sampler.triggerAttack(data.note, Tone.now(), 0.8);
        }
      });
    }
  });

  socket.on('noteOffSelf', (data) => {
    if (syncEnabled) {
      const keyEl = pianoEl.querySelector(`[data-note="${data.note}"]`);
      // Schedule visual feedback removal to match audio timing
      scheduleAt(serverTimeToLocal(data.timestamp), () => {
        keyEl?.classList.remove('active');
        if (!remoteActiveNotes.has(data.note)) {
          sampler?.triggerRelease(data.note);
        }
      });
    }
  });

  socket.on('userLeft', (data) => {
    cleanupUserNotes(data.userId);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  socket.on('reconnect', () => {
    console.log('Reconnected to server');
    // Re-sync time after reconnection
    syncTimeWithServer();
  });
}

// Handle page visibility changes
function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseAllLocalNotes();
    }
  });

  window.addEventListener('blur', () => {
    releaseAllLocalNotes();
  });
}

// Start the app
init();
setupVisibilityHandler();
