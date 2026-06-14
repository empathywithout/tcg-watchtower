// api/auth/google/callback.js
// Handles Google OAuth callback — creates same JWT session as Discord login

import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/portfolio?auth=error');

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI || 'https://tcgwatchtower.com/api/auth/google/callback';

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });

    if (!tokenRes.ok) return res.redirect('/portfolio?auth=error');
    const { access_token, id_token } = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) return res.redirect('/portfolio?auth=error');
    const googleUser = await userRes.json();

    // Build a stable user ID from Google sub (prefix with g_ to avoid Discord ID collisions)
    const userId   = `g_${googleUser.id}`;
    const username = googleUser.name || googleUser.email.split('@')[0];
    const avatar   = googleUser.picture || null;

    // Create 30-day JWT — same shape as Discord session
    const token = await new SignJWT({
      id:       userId,
      username,
      avatar,
      email:    googleUser.email,
      provider: 'google',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(SECRET);

    res.setHeader('Set-Cookie',
      `tcgw_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    );

    res.redirect('/portfolio?auth=success');
  } catch (e) {
    console.error('Google auth callback error:', e);
    res.redirect('/portfolio?auth=error');
  }
}
