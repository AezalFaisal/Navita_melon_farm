# Navita Melon Farm – Multiplayer Virtual Tour (Three.js)

A browser app: visitors choose an avatar, enter a name and walk the farm **together with other visitors**, take a
guided tour of every place, or give voice / typed commands ("go to the cafe", "run to the pool", "triple speed").

## Run it on your computer

```bash
npm install          # once
npm run dev          # http://localhost:5173   (also runs the multiplayer socket)
```

Open it in **two browser tabs** (or two windows) to see yourself from another visitor's point of view.
Other computers on the same Wi-Fi can join with the `Network:` address that `npm run dev` prints.

Production mode (what you deploy):

```bash
npm run build        # builds ./dist
npm start            # website + multiplayer on http://localhost:3000   (PORT env variable changes the port)
```

## Put it on the internet so many people can join

Multiplayer needs a small always-on server, so a *static-only* host (Netlify drag-and-drop) is **not** enough.
`npm start` runs one Node server that serves the website and the realtime socket together.

**Easiest: Render.com (free plan available)**
1. Put this folder on GitHub (the included `.gitignore` skips node_modules / dist).
2. On https://render.com: **New → Blueprint** → choose the repo → **Apply** (it reads `render.yaml`).
   Or **New → Web Service** with Build `npm install && npm run build` and Start `npm start`.
3. Share the `https://….onrender.com` link. Everyone who opens it appears on the same farm.

Other hosts work too (Railway, Fly.io, a VPS…): any host that runs `npm start` and supports WebSockets.
The free Render plan sleeps when nobody visits (first load ~30 s) – for the demo, open the link a minute earlier.

*Website on Netlify + server elsewhere:* build with `VITE_WS_URL=wss://your-server.example.com/ws npm run build`.

**Capacity:** one shared room, up to 100 visitors at once (`maxPlayers` in `server/multiplayer.js`). Each visitor sends
about 10 small messages/second only while moving. The 24 nearest visitors are drawn at full detail; others are hidden.

Add `?solo=1` to the address to play alone without connecting.

## Avatars (4)

| Avatar | File | Clips used | Extras |
|---|---|---|---|
| Melon Explorer | `melon_explorer.glb` | Idle, Walk, Run, Pick, Wave, Cheer | facial expressions (😀😆😉😮😢😠), blinking, talking mouth |
| Straw-Hat Farmer | `farmer.glb` (Tripo model) | Idle, Walk, Run, Harvest→Pick | |
| Melon Farmer | `melon_farmer.glb` | Walk, Run, Harvest→Pick (rest pose when standing) | |
| Meli | `meli_girl.glb` | Idle, Walk, Run, Harvest→Pick, Celebrate→Cheer | |

Add or replace an avatar: put the rigged `.glb` in `public/models/avatars/` and add an entry in `src/avatars.js`
(file name, height, and which clip names to use for Idle / Walk / Run / Pick / Wave / Cheer). The player's list,
previews and the multiplayer avatar index follow that list automatically. (The server accepts 4 avatar numbers – raise
`avatarCount` in `server/multiplayer.js` if you add more.)

## Speed boost

Click the **⚡ 1×** button (top right) to cycle **1× → 2× → 3×**, press **+ / –**, or say *"double speed"*,
*"triple speed"*, *"normal speed"*. It applies to walking, running, voice commands and the guided tour
(a full 19-stop tour takes about 3 minutes at 3×). Movement is done in small steps so a boost can never push you through a wall.

## Three camera views

| Key | View |
|---|---|
| `1` | **Aerial** – the whole farm from above, slowly orbiting, every place labelled and every visitor tagged. Click a label to walk there |
| `2` | **Follow** – behind the avatar (default) |
| `3` | **First person** – through the avatar's eyes |

## Controls

| Action | Keys |
|---|---|
| Walk | `W A S D` or arrow keys (relative to the camera) |
| Run | hold `Shift` (touch: RUN button) |
| Speed 1×/2×/3× | `+` / `–`, or the ⚡ button |
| Look / zoom | drag the mouse / scroll wheel |
| Voice on/off | `V` or the 🎤 button |
| Guided tour start/stop | `T` |
| Labels on/off | `L` |
| Places menu | `M` |
| Pick a melon | `E` |
| Stop everything | `Esc` |
| Click the minimap | walks to that spot (numbered dots = tour stops, blue dots = other visitors) |

## Guided tour

Visits **all 19 places** in a loop (order = `TOUR_ORDER` in `src/data.js`; spoken text = `PLACE_INFO` there – placeholder
text, replace it with the owner's real descriptions). The Tour panel lists every stop; click one to start from there.

## Voice / typed commands

- `go to the cafe`, `take me to reception`, `visit melon information two`, `go to the pond`
- `run to the pool`, `walk`, `run`, `stop`, `walk north 20 meters`, `turn left`, `turn around`
- `pick up a melon`, `go to the melon farm and pick up one melon`
- `start the tour`, `next place`, `pause the tour`, `stop the tour`
- `double speed`, `triple speed`, `normal speed`, `faster`, `slower`
- `smile`, `laugh`, `wink`, `surprised`, `sad`, `angry`, `wave`, `cheer` (expressions need the Melon Explorer)
- `hide labels`, `show labels`, `where am I`, `help`

Voice input needs Chrome or Edge and https (or localhost). North = the top of the minimap.

## Files

```
index.html, src/style.css
src/main.js          app: scene, camera views, UI, commands, tour, other visitors
src/net.js           multiplayer client (WebSocket)
src/avatars.js       the avatar list        src/clipavatar.js   animation-clip avatar (+ expressions)
src/player.js, nav.js   walking, collision, A* path-finding, speed boost
src/commands.js, voice.js, minimap.js, data.js
server/multiplayer.js   realtime room (protocol described at the top of the file)
server/index.js         production server: website + /ws on one port
render.yaml             one-click Render.com deployment
public/models/          melon_farm.glb, navgrid.json, tour.json, avatars/*.glb
tools/                  Blender scripts (see below)
```

## Changing the farm in Blender

The working file is `Navita_Melon_Form_WEB.blend`. After editing it, re-export from a terminal:

```powershell
$blend = "C:\Users\FCC\Documents\Navita_Melon_Farm_Architect Students\Navita_Melon_Form_WEB.blend"
$blender = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"
& $blender -b $blend --python tools\export_glb.py   -- "public\models\melon_farm.glb"   # the farm model
& $blender -b $blend --python tools\make_navgrid.py -- "public\models\navgrid.json"     # where people can walk
```

`tools/make_avatar.py` rebuilds the Melon Explorer; `tools/export_fbx.py` makes an FBX of the farm for sharing.

## Notes

- Multiplayer is "trust the client": positions are range-checked and rate-limited on the server, but a determined
  cheater could still lie about their own position. Fine for a showcase; add server-side checks before any competition.
- The glass buildings and the greenhouse have no door geometry, so avatars walk around them, not through them.
- Collected melons are a counter plus a hand animation (the vines' melons are part of the merged farm model).
- Cars and background people were removed (they were not reliable); other visitors are the people on the farm now.
