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
const JWT_SECRET = process.env.JWT_SECRET || 'sleepyafk-super-secret-2024';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if (!fs.existsSync(BOTS_FILE)) fs.writeFileSync(BOTS_FILE, JSON.stringify([]));

function readUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function writeUsers(d) { fs.writeFileSync(USERS_FILE, JSON.stringify(d, null, 2)); }
function readBots() { return JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8')); }
function writeBots(d) { fs.writeFileSync(BOTS_FILE, JSON.stringify(d, null, 2)); }

const activeBots = new Map();

function addLog(botId, message, type = 'info') {
  const runtime = activeBots.get(botId);
  const entry = { time: new Date().toISOString(), message, type };
  if (runtime) { runtime.logs.push(entry); if (runtime.logs.length > 300) runtime.logs.shift(); }
  io.emit('bot:log', { botId, entry });
}

function startAntiAfk(botId, bot, config) {
  const intervals = [];
  if (config.jumpEnabled && config.jumpInterval > 0) {
    intervals.push(setInterval(() => {
      try { if (bot?.entity) { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 300); addLog(botId, '🦘 Anti-AFK: jumped', 'afk'); } } catch {}
    }, config.jumpInterval * 1000));
  }
  if (config.walkEnabled && config.walkInterval > 0) {
    intervals.push(setInterval(() => {
      try { if (bot?.entity) { const dirs = ['forward','back','left','right']; const dir = dirs[Math.floor(Math.random()*dirs.length)]; bot.setControlState(dir, true); setTimeout(() => bot.setControlState(dir, false), 800+Math.random()*400); addLog(botId, `🚶 Anti-AFK: walked ${dir}`, 'afk'); } } catch {}
    }, config.walkInterval * 1000));
  }
  if (config.lookEnabled && config.lookInterval > 0) {
    intervals.push(setInterval(() => {
      try { if (bot?.entity) { bot.look((Math.random()*Math.PI*2)-Math.PI, (Math.random()*Math.PI/2)-Math.PI/4, false); addLog(botId, '👀 Anti-AFK: looked around', 'afk'); } } catch {}
    }, config.lookInterval * 1000));
  }
  return intervals;
}

function startTimedMessages(botId, bot, timedMessages) {
  const intervals = [];
  if (!Array.isArray(timedMessages)) return intervals;
  timedMessages.forEach(tm => {
    if (!tm.enabled || !tm.message?.trim()) return;
    const totalMs = ((parseInt(tm.hours)||0)*3600 + (parseInt(tm.minutes)||0)*60 + (parseInt(tm.seconds)||0)) * 1000;
    if (totalMs < 5000) { addLog(botId, `⚠️ Skipped timed msg "${tm.message}" — interval too short (min 5s)`, 'warn'); return; }
    const id = setInterval(() => {
      try { if (bot?.entity) { bot.chat(tm.message.trim()); const label = tm.message.trim().startsWith('/') ? '⚡ Command' : '📢 Timed msg'; addLog(botId, `${label}: ${tm.message.trim()}`, 'timed'); } } catch {}
    }, totalMs);
    intervals.push(id);
    const hStr = (parseInt(tm.hours)||0) > 0 ? `${tm.hours}h ` : '';
    const mStr = (parseInt(tm.minutes)||0) > 0 ? `${tm.minutes}m ` : '';
    const sStr = (parseInt(tm.seconds)||0) > 0 ? `${tm.seconds}s` : '';
    addLog(botId, `⏱ Scheduled: "${tm.message.trim()}" every ${hStr}${mStr}${sStr}`, 'info');
  });
  return intervals;
}

function stopIntervals(arr) { arr.forEach(id => clearInterval(id)); }

function startBot(botConfig) {
  const { id, host, port, username, version, antiAfk, timedMessages, autoRejoin, autoLeave, onJoinCommand } = botConfig;
  if (activeBots.has(id)) { addLog(id, '⚠️ Bot already running', 'warn'); return; }
  addLog(id, `🔌 Connecting to ${host}:${port} as ${username}...`, 'info');
  let bot;
  try {
    bot = mineflayer.createBot({ host, port: parseInt(port,10), username, version: version||false, auth: 'offline', hideErrors: false });
  } catch(err) {
    addLog(id, `❌ Failed to create bot: ${err.message}`, 'error');
    io.emit('bot:statusChange', { botId: id, status: 'error' });
    return;
  }
  const runtime = { bot, afkIntervals: [], msgIntervals: [], logs: [], stopping: false };
  activeBots.set(id, runtime);
  io.emit('bot:statusChange', { botId: id, status: 'connecting' });

  bot.once('spawn', () => {
    addLog(id, `✅ Bot spawned successfully!`, 'success');
    io.emit('bot:statusChange', { botId: id, status: 'online' });
    runtime.afkIntervals = startAntiAfk(id, bot, antiAfk||{});
    runtime.msgIntervals = startTimedMessages(id, bot, timedMessages||[]);
    if (onJoinCommand && onJoinCommand.trim()) {
      setTimeout(() => {
        try { bot.chat(onJoinCommand.trim()); addLog(id, `⚡ On-join command sent: ${onJoinCommand.trim()}`, 'sent'); } catch {}
      }, 1500);
    }
  });

  bot.on('chat', (uname, message) => addLog(id, `💬 <${uname}> ${message}`, 'chat'));
  bot.on('whisper', (uname, message) => addLog(id, `📩 [Whisper] <${uname}> ${message}`, 'chat'));

  function tryRejoin(label, reason) {
    addLog(id, `${label}: ${reason||'connection ended'}`, 'error');
    cleanupBot(id);
    io.emit('bot:statusChange', { botId: id, status: 'offline' });
    if (autoRejoin && !runtime.stopping) {
      addLog(id, `🔄 Auto-rejoin in 5 seconds...`, 'warn');
      setTimeout(() => {
        const freshConfig = readBots().find(b => b.id === id);
        if (freshConfig && !activeBots.has(id)) startBot(freshConfig);
      }, 5000);
    }
  }

  bot.on('kicked', (reason) => {
    let msg = reason;
    try { msg = JSON.parse(reason)?.text || JSON.stringify(JSON.parse(reason)); } catch {}
    if (autoLeave) {
      addLog(id, `👢 Kicked — auto-leave active, not rejoining: ${msg}`, 'warn');
      cleanupBot(id);
      io.emit('bot:statusChange', { botId: id, status: 'offline' });
      return;
    }
    tryRejoin('👢 Kicked', msg);
  });
  bot.on('error', (err) => tryRejoin('❌ Error', err.message));
  bot.on('end', (reason) => {
    if (runtime.stopping) {
      addLog(id, `🔴 Disconnected: ${reason||'connection ended'}`, 'warn');
      cleanupBot(id);
      io.emit('bot:statusChange', { botId: id, status: 'offline' });
      return;
    }
    tryRejoin('🔴 Disconnected', reason||'connection ended');
  });
  bot.on('health', () => {
    io.emit('bot:stats', { botId: id, health: Math.round(bot.health), food: Math.round(bot.food), ping: bot.player?.ping??0 });
  });
}

function stopBot(botId) {
  const runtime = activeBots.get(botId);
  if (!runtime) return;
  runtime.stopping = true;
  addLog(botId, '🛑 Stopping bot...', 'warn');
  stopIntervals(runtime.afkIntervals);
  stopIntervals(runtime.msgIntervals);
  try { runtime.bot.quit('User requested disconnect'); } catch {}
  activeBots.delete(botId);
  io.emit('bot:statusChange', { botId: botId, status: 'offline' });
}

function cleanupBot(botId) {
  const runtime = activeBots.get(botId);
  if (!runtime) return;
  stopIntervals(runtime.afkIntervals);
  stopIntervals(runtime.msgIntervals);
  activeBots.delete(botId);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken' });
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
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

function defaultTimedMessages() {
  return Array.from({ length: 5 }, (_, i) => ({ id: (Date.now()+i).toString(), enabled: false, message: '', hours: 0, minutes: 5, seconds: 0 }));
}

app.get('/api/bots', authMiddleware, (req, res) => {
  const bots = readBots().filter(b => b.owner === req.user.username);
  res.json(bots.map(b => ({ ...b, status: activeBots.has(b.id) ? 'online' : 'offline', logs: activeBots.get(b.id)?.logs||[] })));
});

app.post('/api/bots', authMiddleware, (req, res) => {
  const { name, host, port, username, version, antiAfk, timedMessages, autoRejoin, autoLeave, onJoinCommand } = req.body;
  if (!name || !host || !port || !username) return res.status(400).json({ error: 'name, host, port and username required' });
  const bots = readBots();
  const newBot = {
    id: Date.now().toString(), owner: req.user.username,
    name, host, port: parseInt(port,10), username, version: version||'',
    antiAfk: { jumpEnabled: antiAfk?.jumpEnabled??true, jumpInterval: antiAfk?.jumpInterval??30, walkEnabled: antiAfk?.walkEnabled??true, walkInterval: antiAfk?.walkInterval??45, lookEnabled: antiAfk?.lookEnabled??true, lookInterval: antiAfk?.lookInterval??20 },
    timedMessages: timedMessages??defaultTimedMessages(),
    autoRejoin: autoRejoin??false, autoLeave: autoLeave??false, onJoinCommand: onJoinCommand??'',
    createdAt: new Date().toISOString()
  };
  bots.push(newBot); writeBots(bots); res.json(newBot);
});

app.put('/api/bots/:id', authMiddleware, (req, res) => {
  const bots = readBots();
  const idx = bots.findIndex(b => b.id === req.params.id && b.owner === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Bot not found' });
  const { name, host, port, username, version, antiAfk, timedMessages, autoRejoin, autoLeave, onJoinCommand } = req.body;
  bots[idx] = { ...bots[idx], name, host, port: parseInt(port,10), username, version: version||'', antiAfk, timedMessages, autoRejoin: autoRejoin??false, autoLeave: autoLeave??false, onJoinCommand: onJoinCommand??'' };
  writeBots(bots);
  const runtime = activeBots.get(req.params.id);
  if (runtime) { stopIntervals(runtime.afkIntervals); stopIntervals(runtime.msgIntervals); runtime.afkIntervals = startAntiAfk(req.params.id, runtime.bot, antiAfk); runtime.msgIntervals = startTimedMessages(req.params.id, runtime.bot, timedMessages||[]); addLog(req.params.id, '⚙️ Settings updated and applied live', 'info'); }
  res.json(bots[idx]);
});

app.delete('/api/bots/:id', authMiddleware, (req, res) => {
  const bots = readBots();
  const idx = bots.findIndex(b => b.id === req.params.id && b.owner === req.user.username);
  if (idx === -1) return res.status(404).json({ error: 'Bot not found' });
  if (activeBots.has(req.params.id)) stopBot(req.params.id);
  bots.splice(idx, 1); writeBots(bots); res.json({ success: true });
});

app.post('/api/bots/:id/start', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  startBot(bot); res.json({ success: true });
});

app.post('/api/bots/:id/stop', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  stopBot(req.params.id); res.json({ success: true });
});

app.post('/api/bots/:id/chat', authMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const runtime = activeBots.get(req.params.id);
  if (!runtime) return res.status(400).json({ error: 'Bot not running' });
  try { runtime.bot.chat(message); addLog(req.params.id, `📤 [You] ${message}`, 'sent'); res.json({ success: true }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bots/:id/logs', authMiddleware, (req, res) => {
  const bot = readBots().find(b => b.id === req.params.id && b.owner === req.user.username);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json(activeBots.get(req.params.id)?.logs||[]);
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => { console.log(`[Socket] ${socket.user.username} connected`); });

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║        SleepyAfk is running!         ║`);
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
