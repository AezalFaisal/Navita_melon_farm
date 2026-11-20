# Navita Melon Farm - hosting instructions (Docker)

Everything needed is in this folder. One container serves the website and the multiplayer socket.

## Requirements
A server with Docker (and the Docker Compose plugin). Nothing else - no Node.js needed on the server.

## Start
```
docker compose up -d --build
```
Open `http://<server-address>:3000`.

Without compose:
```
docker build -t navita-melon-farm .
docker run -d -p 3000:3000 --restart unless-stopped --name navita navita-melon-farm
```

## Stop / update
```
docker compose down
docker compose up -d --build      # after replacing the files with a new version
```

## Notes
- Port: change `3000:3000` in `docker-compose.yml` (left number) to publish on another port, e.g. `80:3000`.
- Multiplayer uses a WebSocket at `/ws` on the same address. Behind nginx/Apache, enable WebSocket upgrade for `/ws`.
- Voice commands need the microphone, which browsers allow only on `https://` (or localhost). Put the site behind HTTPS (e.g. Caddy or nginx with a certificate) so visitors can use voice.
- Health check URL: `/health` (returns `ok`).
