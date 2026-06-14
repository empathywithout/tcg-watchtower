// api/auth/me.js
import { verifySession } from './_verify.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const user = await verifySession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.status(200).json({ id: user.id, username: user.username, avatar: user.avatar, provider: user.provider });
}
