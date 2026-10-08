# Frontend (React + Vite + PWA)

See the repo-root `README.md` for how to run this alongside the backend.

## Backend API URL

The app calls the backend with same-origin `/api/...` paths. In production the
backend serves the built app itself (see the root `Dockerfile`), so no API URL
is configured. In dev, `npm run dev` proxies `/api` to
`http://localhost:8000`; override the target with `VITE_DEV_API_PROXY`
(docker-compose sets it to `http://backend:8000`). `VITE_API_BASE_URL` is an
optional origin-only override (no `/api` suffix), normally left unset; the
transitional two-service Railway frontend still sets it to the backend URL.
Copy `.env.example` to `.env` (or `.env.local`) to edit these:

```sh
cp .env.example .env
```

Sign-in is open to any Google account with a verified email; each account sees only its own items. Sign-in also needs `VITE_GOOGLE_CLIENT_ID` set (build-time) — see "Access control" in the repo-root
`README.md` for the full Google OAuth Client ID setup.

## Test from your phone

The whole point of this app is taking photos with a phone camera, so
you'll want to load it on an actual phone rather than only testing in a
desktop browser. `vite.config.js` already sets `server.host=true`, which
makes the Vite dev server listen on your machine's LAN IP (not just
`localhost`) so a phone on the same Wi-Fi can reach it. Two things need
to point at that LAN IP instead of `localhost` for this to work end to
end:

1. **Find your dev machine's LAN IP:**

   ```sh
   # Linux
   hostname -I

   # macOS
   ipconfig getifaddr en0
   ```

   (On macOS, if you're on Wi-Fi and `en0` doesn't return anything, try
   `en1` instead — it depends on the machine.)

   This prints something like `192.168.1.50`. That's the placeholder
   used in the example below — substitute your own.

2. **Nothing to point at the backend** — `npm run dev` proxies `/api`
   to the backend, and the phone only talks to the Vite server. Just make
   sure the backend is running on the dev machine at port 8000 (or set
   `VITE_DEV_API_PROXY`).

3. **CORS is not involved** (requests are same-origin through the proxy).

4. **Start the frontend** as usual (`npm run dev`) and, on your phone
   (same Wi-Fi network), browse to `http://<your-LAN-IP>:5173` (e.g. `http://192.168.1.50:5173`).

Full worked example, run from the repo root in two terminals:

```sh
# terminal 1 — backend
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# terminal 2 — frontend
cd frontend
npm run dev
```

Then, on your phone, open `http://<your-LAN-IP>:5173` (e.g. `http://192.168.1.50:5173`) in a browser and
try the photo capture flow.

## Tests

Component tests use Vitest + React Testing Library:

```sh
npm test
```

This is a React + Vite template with `vite-plugin-pwa` added for PWA
manifest/service-worker generation. Currently two official React plugins
are available for Vite:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
