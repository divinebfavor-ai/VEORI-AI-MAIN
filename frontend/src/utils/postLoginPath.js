// Where to send someone right after they sign in or register. A team invite they
// opened before signing in takes priority, so they land on accepting it.
export default function postLoginPath() {
  try {
    if (sessionStorage.getItem('veori_pending_team_invite')) return '/team/accept'
  } catch { /* storage unavailable */ }
  return '/dashboard'
}
