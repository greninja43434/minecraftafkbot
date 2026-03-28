const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'minecraft-afk-super-secret-2024';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');

// ─── Data Layer ───────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if (!fs.existsSync(BOTS_FILE)) fs.writeFileSync(BOTS_FILE, JSON.stringify([]));

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function writeUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
function readBots() {
  return JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
}
function writeBots(data) {
  fs.writeFileSync(BOTS_FILE, JSON.stringify(data, null, 2));
}

// ─── Active Bot Runtime State ──────────────────────────────────────────────────

const activeBots = new Map(); // botId -> { bot, intervals, logs }

function getBotRuntime(botId) {
  return activeBots.get(botId);
}

function addLog(botId, message, type = 'info') {
  const runtime = activeBots.get(botId);
  const entry = { time: new Date().toISOString(), message, type };
  if (runtime) {
    runtime.logs.push(entry);
    if (runtime.logs.length > 200) runtime.logs.shift();
  }
  io.emit('bot:log', { botId, entry });
}

// ─── Anti-AFK Engine ──────────────────────────────────────────────────────────

function startAntiAfk(botId, bot, config) {
  const intervals = [];

  if (config.jumpEnabled && config.jumpInterval > 0) {
    const jumpMs = config.jumpInterval * 1000;
    const jid = setInterval(() => {
      try {
        if (bot && bot.entity) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300);
          addLog(botId, '🦘 Anti-AFK: jumped', 'afk');
        }
      } catch (e) { /* bot may be disconnected */ }
    }, jumpMs);
    intervals.push(jid);
  }

  if (config.walkEnabled && config.walkInterval > 0) {
    const walkMs = config.walkInterval * 1000;
    const wid = setInterval(() => {
      try {
        if (bot && bot.entity) {
          const dirs = ['forward', 'back', 'left', 'right'];
          const dir = dirs[Math.floor(Math.random() * dirs.length)];
          bot.setControlState(dir, true);
          setTimeout(() => {
            bot.setControlState(dir, false);
          }, 800 + Math.random() * 400);
          addLog(botId, `🚶 Anti-AFK: walked ${dir}`, 'afk');
        }
      } catch (e) { /* bot may be disconnected */ }
    }, walkMs);
    intervals.push(wid);
  }

  if (config.lookEnabled && config.lookInterval > 0) {
    const lookMs = config.lookInterval * 1000;
    const lid = setInterval(() => {
      try {
        if (bot && bot.entity) {
          const yaw = (Math.random() * Math.PI * 2) - Math.PI;
          const pitch = (Math.random() * Math.PI / 2) - Math.PI / 4;
          bot.look(yaw, pitch, false);
          addLog(botId, '👀 Anti-AFK: looked around', 'afk');
        }
      } catch (e) { /* bot may be disconnected */ }
    }, lookMs);
    intervals.push(lid);
  }

  return intervals;
}

function stopAntiAfk(intervals) {
  intervals.forEach(id => clearInterval(id));
}

// ─── Bot Lifecycle ─────────────────────────────────────────────────────────────

function startBot(botConfig) {
  const { id, host, port, username, version, antiAfk } = botConfig;

  if (activeBots.has(id)) {
    addLog(id, '⚠️ Bot already running', 'warn');
    return;
  }

  addLog(id, `🔌 Connecting to ${host}:${port} as ${username}...`, 'info');

  let bot;
  try {
    bot = mineflayer.createBot({
      host,
      port: parseInt(port, 10),
      username,
      version: version || false,
      auth: 'offline',
      hideErrors: false
    });
  } catch (err) {
    addLog(id, `❌ Failed to create bot: ${err.message}`, 'error');
    io.emit('bot:statusChange', { botId: id, status: 'error' });
    return;
  }

  const runtime = { bot, intervals: [], logs: [] };
  activeBots.set(id, runtime);

  io.emit('bot:statusChange', { botId: id, status: 'connecting' });

  bot.once('spawn', () => {
    addLog(id, `✅ Bot spawned successfully!`, 'success');
    io.emit('bot:statusChange', { botId: id, status: 'online' });
    const intervals = startAntiAfk(id, bot, antiAfk);
    runtime.intervals = intervals;
  });

  bot.on('chat', (username, message) => {
    addLog(id, `💬 <${username}> ${message}`, 'chat');
  });

  bot.on('whisper', (username, message) => {
    addLog(id, `📩 [Whisper] <${username}> ${message}`, 'chat');
  });

  bot.on('kicked', (reason) => {
    let msg = reason;
    try { msg = JSON.parse(reason)?.text || JSON.stringify(JSON.parse(reason)); } catch {}
    addLog(id, `👢 Kicked: ${msg}`, 'error');
    cleanupBot(id);
    io.emit('bot:statusChange', { botId: id, status: 'offline' });
  });

  bot.on('error', (err) => {
    addLog(id, `❌ Error: ${err.message}`, 'error');
    cleanupBot(id);
    io.emit('bot:statusChange', { botId: id, status: 'error' });
  });

  bot.on('end', (reason) => {
    addLog(id, `🔴 Disconnected: ${reason || 'connection ended'}`, 'warn');
    cleanupBot(id);
    io.emit('bot:statusChange', { botId: id, status: 'offline' });
  });

  bot.on('health', () => {
    io.emit('bot:stats', {
      botId: id,
      health: Math.round(bot.health),
      food: Math.round(bot.food),
      ping: bot.player?.ping ?? 0
    });
  });
}

function stopBot(botId) {
  const runtime = activeBots.get(botId);
  if (!runtime) return;
  addLog(botId, '🛑 Stopping bot...', 'warn');
  stopAntiAfk(runtime.intervals);
  try { runtime.bot.quit('User requested disconnect'); } catch {}
  activeBots.delete(botId);
  io.emit('bot:statusChange', { botId: botId, status: 'offline' });
}

function cleanupBot(botId) {
  const runtime = activeBots.get(botId);
  if (!runtime) return;
  stopAntiAfk(runtime.intervals);
  activeBots.delete(botId);
}

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Auth Routes ───────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, 10);
  users.push({ id: Date.now().toString(), username, password: hash, createdAt: new Date().toISOString() });
  writeUsers(users);

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username.toLowerCase() === username?.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ─── Bot Config Routes ─────────────────────────────────────────────────────────

app.get('/api/bots', authMiddleware, (req, res) => {
  const bots = readBots().filter(b => b.owner === req.user.username);
  const withStatus = bots.map(b => ({
    ...b,
    status: activeBots.has(b.id) ? 'online' : 'offline',
    logs: activeBots.get(b.id)?.logs || []
  }));
  res.json(withStatus);
});

app.post('/api/bots', authMiddleware, (req, res) => {
  const { name, host, port, username, version, antiAfk } = req.body;
  if (!name || !host || !port || !username) {
    return res.status(400).json({ error: 'name, host, port, and username are required' });
  }
  const bots = readBots();
  const newBot = {
    id: Date.now().toString(),
    owner: req.user.username,
    name,
    host,
    port: parseInt(port, 10),
    username,
    version: version || '',
    antiAfk: {
      jumpEnabled: antiAfk?.jumpEnabled ?? true,
      jumpInterval: antiAfk?.jumpInterval ?? 30,
      walkEnabled: antiAfk?.walkEnabled ?? true,
      walkInterval: antiAfk?.walkInterval ?? 45,
      lookEnabled: antiAfk?.lookEnabled ?? true,
      lookInterval: antiAfk?.lookInterval ?? 20
    },
    createdAt: new Date().toISOString()
  };
  bots.push(newBot);
  writeBots(bots);
  res.json(newBot);
});

app.put('/api/bots/:id', authMiddleware, (req, res) => {
  const bots = readBots();
  const idx = bots.findIndex(b => b.id === req.params.id && b.owner === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Bot not found' });

  const { name, host, port, username, version, antiAfk } = req.body;
  bots[idx] = { ...bots[idx], name, host, port: parseInt(port, 10), username, version: version || '', antiAfk };
  writeBots(bots);

  // If running, update anti-afk intervals
  const runtime = activeBots.get(req.params.id);
  if (runtime) {
    stopAntiAfk(runtime.intervals);
    runtime.intervals = startAntiAfk(req.params.id, runtime.bot, antiAfk);
    addLog(req.params.id, '⚙️ Anti-AFK settings updated live', 'info');
  }

  res.json(bots[idx]);
});

app.delete('/api/bots/:id', authMiddleware, (req, res) => {
  const bots = readBots();
  const idx = bots.findIndex(b => b.id === req.params.id && b.owner === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Bot not found' });

  if (activeBots.has(req.params.id)) stopBot(req.params.id);
  bots.splice(idx, 1);
  writeBots(bots);
  res.json({ success: true });
});

// ─── Bot Control Routes ────────────────────────────────────────────────────────

app.post('/api/bots/:id/start', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  startBot(bot);
  res.json({ success: true });
});

app.post('/api/bots/:id/stop', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  stopBot(req.params.id);
  res.json({ success: true });
});

app.post('/api/bots/:id/chat', authMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const runtime = activeBots.get(req.params.id);
  if (!runtime) return res.status(400).json({ error: 'Bot is not running' });

  try {
    runtime.bot.chat(message);
    addLog(req.params.id, `📤 [You] ${message}`, 'sent');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bots/:id/logs', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const runtime = activeBots.get(req.params.id);
  res.json(runtime?.logs || []);
});

// ─── Socket.io Auth ────────────────────────────────────────────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket] ${socket.user.username} connected`);
  socket.on('disconnect', () => {
    console.log(`[Socket] ${socket.user.username} disconnected`);
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Minecraft AFK Manager running!     ║`);
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
