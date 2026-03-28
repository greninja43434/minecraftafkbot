# SleepyAfk — Minecraft AFK Bot Manager

A web-based Minecraft AFK bot manager with multi-user support, real-time console, and automation features.

## Features

- **Multi-bot management** — run multiple bots simultaneously
- **Auto-Rejoin** — automatically reconnects after kick/disconnect
- **Auto-Leave on Kick** — stay disconnected after a kick (overrides auto-rejoin)
- **On-Join Command** — send a command automatically when the bot spawns (e.g. `/lobby`)
- **Anti-AFK** — jump, walk, look-around on configurable intervals
- **Timed Messages** — schedule messages/commands with hours, minutes, seconds precision
- **Live Console** — real-time log stream, send chat/commands manually
- **Live config** — update settings without restarting

## Setup

```bash
npm install
npm start
```

Open http://localhost:3000

## New in v2.0

- Rebranded to **SleepyAfk**
- Auto-Rejoin toggle (reconnects after disconnect/kick)
- Auto-Leave on Kick toggle (suppresses rejoin after being kicked)
- On-Join Command field — type a command to run on every join
- Timed messages now support **hours / minutes / seconds**
