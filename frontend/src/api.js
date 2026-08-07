// Configurable via a Vite env var so the frontend can be pointed at a
// different backend (e.g. a docker-compose service name, or a deployed
// host) without code changes. See `.env.example`.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
