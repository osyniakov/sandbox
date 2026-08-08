# Frontend (React + Vite + PWA)

See the repo-root `README.md` for how to run this alongside the backend.

## Backend API URL

The photo capture/upload page (`src/App.jsx`) calls the backend's
`POST /items` endpoint. The base URL is read from the `VITE_API_BASE_URL`
Vite env var, defaulting to `http://localhost:8000` if unset. Copy
`.env.example` to `.env` (or `.env.local`) and edit it if your backend
isn't running at the default local address:

```sh
cp .env.example .env
```

Sign-in also needs `VITE_GOOGLE_CLIENT_ID` set (build-time, same as
`VITE_API_BASE_URL` above) — see "Access control" in the repo-root
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

2. **Point the frontend at the backend via that IP** (not
   `localhost`, since `localhost` on the phone means the phone itself).
   Set `VITE_API_BASE_URL` in `frontend/.env` (or `.env.local`):

   ```sh
   # frontend/.env
   VITE_API_BASE_URL=http://192.168.1.50:8000
   ```

3. **Allow that origin through the backend's CORS allowlist.** Set
   `ALLOWED_ORIGINS` (comma-separated if you need more than one) when
   starting the backend:

   ```sh
   # from backend/
   ALLOWED_ORIGINS=http://192.168.1.50:5173 uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   If unset, `ALLOWED_ORIGINS` defaults to
   `http://localhost:5173,http://127.0.0.1:5173` (today's dev-only
   default), which is why the app works out of the box on a single
   machine but not from a phone until you set this.

4. **Start the frontend** as usual (`npm run dev`) and, on your phone
   (same Wi-Fi network), browse to `http://192.168.1.50:5173`.

Full worked example, run from the repo root in two terminals, after
finding your LAN IP is `192.168.1.50`:

```sh
# terminal 1 — backend
cd backend
ALLOWED_ORIGINS=http://192.168.1.50:5173 uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# terminal 2 — frontend
cd frontend
echo "VITE_API_BASE_URL=http://192.168.1.50:8000" > .env.local
npm run dev
```

Then, on your phone, open `http://192.168.1.50:5173` in a browser and
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
