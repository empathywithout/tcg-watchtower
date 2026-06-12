// api/auth/callback.js
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/portfolio.html?auth=error');

  try {
    // Exchange code for Discord access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.PORTFOLIO_DISCORD_CLIENT_ID,
        client_secret: process.env.PORTFOLIO_DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) return res.redirect('/portfolio.html?auth=error');

    const { access_token } = await tokenRes.json();

    // Fetch Discord user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) return res.redirect('/portfolio.html?auth=error');

    const user = await userRes.json();

    // Create 30-day JWT session
    const token = await new SignJWT({
      id:       user.id,
      username: user.username,
      avatar:   user.avatar,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(SECRET);

    res.setHeader('Set-Cookie',
      `tcgw_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    );

    // Redirect back to portfolio — the frontend will detect login and merge localStorage
    res.redirect('/portfolio.html?auth=success');
  } catch (e) {
    console.error('Auth callback error:', e);
    res.redirect('/portfolio.html?auth=error');
  }
}
