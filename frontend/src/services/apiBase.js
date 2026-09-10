// ─── Canonical API base URL ───────────────────────────────────────────────────
// THE BUG THIS FIXES: two contradictory conventions existed side by side.
//
//   services/api.js  → baseURL = VITE_API_URL, and every path includes '/api/...'
//                      (so VITE_API_URL must NOT contain /api)
//   most pages       → const API = VITE_API_URL || '<railway>/api'  then `${API}/leads`
//                      (so VITE_API_URL MUST contain /api)
//
// Both cannot be right. VITE_API_URL is set to "https://veori.net" in the Vercel
// build (confirmed by reading the deployed bundle), so the page convention was
// the broken one: it produced https://veori.net/leads/... with no /api prefix.
//
// That path does not match Vercel's /api/:path* rewrite, so it fell through to
// the SPA catch-all and returned index.html with HTTP 200. Calling code saw
// `res.ok === true`, then threw parsing "<!doctype html>" as JSON — surfacing to
// the user as "Couldn't load… try again" while the network tab showed 200 OK.
// That silent-success-then-parse-failure is why it was easy to miss.
//
// Normalising here makes the value correct no matter how VITE_API_URL is set:
//   "https://veori.net"      → "https://veori.net/api"
//   "https://veori.net/api"  → "https://veori.net/api"
//   "https://veori.net/api/" → "https://veori.net/api"
//   unset                    → "<railway>/api"
export const API = (import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app')
  .replace(/\/+$/, '')        // drop trailing slashes
  .replace(/\/api$/, '')      // drop an existing /api so we never double it
  + '/api';

// Bearer header for the pages that use raw fetch instead of the axios client.
export function authHeaders() {
  const token = localStorage.getItem('veori_token') || localStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default API;
