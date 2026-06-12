// api/auth/discord.js
export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id:     process.env.PORTFOLIO_DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope:         'identify',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
}
