<div align="center">

<img src="frontend/public/icon.svg" width="120" alt="Lector Logo" />

# Lector

**Turn your EPUB library into a personal audiobook collection.**

[![GitHub release](https://img.shields.io/github/v/release/LectorEpubtoAudiobook/Lector?style=flat-square&color=6c63ff)](https://github.com/LectorEpubtoAudiobook/Lector/releases)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License](https://img.shields.io/badge/license-MIT-6c63ff?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/react-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

Lector is a self-hosted web application that converts EPUB books to high-quality audiobooks using Kokoro TTS and Anthropic Claude for chapter extraction. It includes a built-in audio player, progress tracking, sleep timer, and personal listening stats — all running in Docker.

</div>

---

## Features

- **EPUB to Audiobook** — Upload any EPUB and convert it to a full audiobook, chapter by chapter
- **High-Quality TTS** — Powered by [Kokoro TTS](https://github.com/remsky/kokoro-fastapi) (GPU-accelerated, local, no external TTS API)
- **AI Chapter Extraction** — Uses Anthropic Claude to intelligently parse EPUB structure and chapter text
- **Built-in Audio Player** — Per-chapter playback with resume-from-where-you-left-off progress tracking
- **Sleep Timer** — Auto-pause after 15, 30, 45, or 60 minutes
- **Completion Tracking** — Books marked as finished with a badge; "Listen Again" support
- **Listening Stats** — Total books, in-progress, completed, and estimated hours listened
- **Search & Filter** — Quickly find books by title or author
- **PWA Ready** — Install to your home screen on mobile
- **Single-User Auth** — Simple username/password login with session tokens and rate limiting
- **Self-Hosted** — All data stays on your machine; no external services except Claude for parsing

---

## Requirements

| Requirement | Notes |
|---|---|
| [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/install/) | v2.x or later |
| NVIDIA GPU | Required for Kokoro TTS (CUDA). See [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) |
| [Anthropic API Key](https://console.anthropic.com) | Used for chapter text extraction from EPUBs |

> **No GPU?** You can swap the Kokoro image for a CPU variant or replace the TTS service — see [Advanced Configuration](#advanced-configuration).

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/LectorEpubtoAudiobook/Lector.git
cd Lector
```

### 2. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
ANTHROPIC_API_KEY=sk-ant-...          # Get one at https://console.anthropic.com
APP_USERNAME=your_username             # Login username
APP_PASSWORD=your_strong_password      # Login password
```

### 3. Start Lector

```bash
docker compose up -d
```

Docker will pull the Kokoro TTS image and build the backend and frontend on first run. This may take a few minutes.

### 4. Open the app

Navigate to **http://localhost:3001** in your browser and log in with the credentials you set in `.env`.

---

## Updating

Pull the latest changes and rebuild:

```bash
git pull
docker compose up -d --build
```

Your library, audio files, and progress are stored in Docker named volumes and are **not affected** by updates.

---

## Configuration

All configuration is done via the `.env` file. Never commit this file — it is gitignored by default.

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude chapter extraction |
| `APP_USERNAME` | Yes | Username for the Lector web login |
| `APP_PASSWORD` | Yes | Password for the Lector web login |

---

## Data & Storage

Lector uses four Docker named volumes for persistent storage:

| Volume | Path in container | Contents |
|---|---|---|
| `audiobook-books` | `/data/books` | Original uploaded EPUB files |
| `audiobook-audio` | `/data/audio` | Generated MP3 audiobook chapters |
| `audiobook-db` | `/data/db` | SQLite database (library + progress) |
| `kokoro-voices` | `/app/api/src/voices` | Kokoro TTS voice models |

To back up your library, back up these Docker volumes or bind-mount them to a local directory.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │                  Docker Network               │
Browser ──── :3001 ─►  Nginx  ──► Frontend (React :3000)          │
                    │          └──► Backend  (FastAPI :8000)        │
                    │                    └──► Kokoro TTS (:8880)    │
                    └──────────────────────────────────────────────┘
```

| Service | Image / Build | Role |
|---|---|---|
| `nginx` | `nginx:alpine` | Reverse proxy, routes `/api/` and `/audio/` to backend, everything else to frontend |
| `frontend` | Built from `./frontend` | React 18 SPA |
| `backend` | Built from `./backend` | FastAPI app — auth, library management, EPUB parsing, TTS orchestration |
| `kokoro` | `ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.2` | Local GPU-accelerated TTS engine |

---

## Advanced Configuration

### Running without a GPU (CPU mode)

Replace the `kokoro` service image in `docker-compose.yml`:

```yaml
kokoro:
  image: ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.2   # CPU variant
  # remove the deploy.resources.reservations block entirely
```

CPU conversion will be significantly slower.

### Accessing from another device on your network

By default Lector binds to `0.0.0.0:3001`, so it is reachable at your machine's local IP (e.g. `http://192.168.1.x:3001`). No additional configuration is needed for LAN access.

### Running on a custom domain

Point your domain at the host machine and update the Nginx `server_name` in `nginx.conf`:

```nginx
server_name yourdomain.example.com;
```

For HTTPS, add a Certbot/Let's Encrypt sidecar or terminate TLS at a reverse proxy in front of Lector.

---

## Stopping & Removing

```bash
# Stop (keeps data)
docker compose down

# Stop and remove all Lector data volumes  ⚠️ destructive
docker compose down -v
```

---

## Tech Stack

- **Backend** — Python 3.11, FastAPI, SQLAlchemy, SQLite, ebooklib, pydub
- **Frontend** — React 18, Axios, Lucide React, qrcode.react
- **TTS** — [Kokoro FastAPI](https://github.com/remsky/kokoro-fastapi) (local, GPU)
- **AI** — [Anthropic Claude](https://www.anthropic.com) (chapter extraction)
- **Proxy** — Nginx
- **Container** — Docker Compose

---

## Legal

Lector is intended for **personal use only**. You are responsible for ensuring you have the legal right to convert any book you upload. Converting copyrighted material you do not own may violate copyright law in your jurisdiction. The authors of Lector accept no liability for misuse.

---

## Support & Donations

If you find Lector useful, consider supporting development:

- **GitHub Sponsors** — [github.com/sponsors/LectorEpubtoAudiobook](https://github.com/sponsors/LectorEpubtoAudiobook)
- **Bitcoin** — `bc1qkfxlhc7a5cxekkdsky2gvshhcckgz5wf8zary3`

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a Pull Request

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/LectorEpubtoAudiobook/Lector/issues).

---

## License

Lector is released under the [MIT License](LICENSE).
