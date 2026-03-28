# AFK.GG — Minecraft AFK Bot Manager

A full-featured Minecraft AFK bot manager with a slick web UI, real-time console, chat, and configurable Anti-AFK.

---

## Features

- 🔐 **Login / Register** — JWT-based auth, all data stored locally
- 🤖 **Multiple Bots** — Add, edit, and delete as many bots as you want
- 🌐 **Custom Server** — Set IP, port, bot username, and Minecraft version per bot
- 💬 **Live Chat** — Type messages/commands directly into any bot's chat
- 📋 **Real-time Console** — Colour-coded log output streamed via Socket.io
- 🦘 **Anti-AFK: Jump** — Bot jumps at a configurable interval (seconds)
- 🚶 **Anti-AFK: Walk** — Bot randomly walks in a direction at a configurable interval
- 👀 **Anti-AFK: Look** — Bot randomly looks around at a configurable interval
- ⚙️ **Live Config** — Change Anti-AFK settings while a bot is running — applied instantly
- 📊 **Stats Bar** — Live health, food, and ping readout
- 🔴 **Start / Stop** — One-click bot control

---

## Requirements

- **Node.js** v18 or newer
- Internet access to reach the Minecraft server

---

## Setup

```bash
# 1. Go into the project folder
cd minecraft-afk-manager

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# Or, for development with auto-restart:
npm run dev
```

Then open **http://localhost:3000** in your browser.

---

## Usage

1. **Register** an account on the login page.
2. Click **+** in the sidebar to add a bot:
   - Give it a display name
   - Enter the Minecraft server IP and port
   - Enter the bot's username (offline/cracked servers only)
   - Choose the Minecraft version (or leave on Auto)
   - Configure Anti-AFK intervals (in seconds)
3. Click the bot in the sidebar to select it, then hit **▶ START**.
4. Watch the console log for connection status and chat messages.
5. Use the chat bar at the bottom to send messages or commands as the bot.
6. Adjust Anti-AFK settings live in the right panel — click **⟳ Apply Now**.

---

## Anti-AFK Settings

| Feature | Default | Min | Max | Description |
|---------|---------|-----|-----|-------------|
| Jump | 30s | 5s | 300s | Bot presses jump every N seconds |
| Walk | 45s | 5s | 300s | Bot walks a random direction every N seconds |
| Look | 20s | 5s | 300s | Bot rotates camera randomly every N seconds |

All can be toggled on/off independently.

---

## Notes

- This only works with **offline/cracked** Minecraft servers (the bot uses offline auth).
- Make sure the server's version matches what you set, or use Auto-detect.
- Data (users, bot configs) is stored in the `data/` folder as JSON files.
- The default port is **3000**. Set `PORT=8080 npm start` to change it.

---

## File Structure

```
minecraft-afk-manager/
├── server.js          # Express + Socket.io + Mineflayer backend
├── package.json
├── data/
│   ├── users.json     # User accounts (auto-created)
│   └── bots.json      # Bot configurations (auto-created)
└── public/
    ├── index.html     # Login / Register page
    ├── dashboard.html # Main dashboard
    └── dashboard.js   # Frontend logic
```
