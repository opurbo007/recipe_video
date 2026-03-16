# me&u Signaling Server — Deploy to Render.com (Free)

## Why we need this server

WebRTC needs a "signaling" layer to exchange connection info (SDP offer/answer + ICE candidates)
between two browsers before direct video can flow. We use Socket.IO for this.

The server does NOT carry any video/audio — it only passes small text messages.
All actual media flows peer-to-peer (or via TURN relay).

---

## Step 1 — Deploy server/ to Render.com (free)

1. Push this whole project to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Configure:
   - **Root directory:** `server`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Click Deploy
6. Copy your URL e.g. `https://me&u-signal.onrender.com`

---

## Step 2 — Set VITE_SIGNAL_URL for the frontend

### On Vercel:

1. Go to your Vercel project → Settings → Environment Variables
2. Add: `VITE_SIGNAL_URL` = `https://your-app.onrender.com`
3. Redeploy

### Locally:

1. Copy `.env.example` to `.env.local`
2. Set `VITE_SIGNAL_URL=http://localhost:3001`
3. Run `npm run dev` in the `server/` folder AND `npm run dev` in the root

---

## Local development (both server + frontend)

Terminal 1 — signaling server:

```bash
cd server
npm install
npm start
# Server running on http://localhost:3001
```

Terminal 2 — React frontend:

```bash
npm install
npm run dev
# Frontend on http://localhost:5173
```

---

## How signaling works

```
Host browser                 Signaling Server             Guest browser
    |                              |                            |
    |------- join-room ----------->|                            |
    |<------ role: host -----------|                            |
    |                              |<------- join-room ---------|
    |                              |-------- role: guest ------>|
    |<------ guest-joined ---------|                            |
    |--- createOffer() ------------|                            |
    |------- offer --------------->|-------- offer ------------>|
    |                              |    setRemoteDescription()  |
    |                              |    createAnswer()          |
    |                              |<------- answer ------------|
    |<------ answer ---------------|                            |
    | setRemoteDescription()       |                            |
    |                              |                            |
    |<====== ICE candidates exchanged via server =============>|
    |                                                           |
    |<================== Direct WebRTC video ==================>|
```
