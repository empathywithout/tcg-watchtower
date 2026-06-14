// api/auth/logout.js
export default function handler(req, res) {
  const clearCookie = (domain) =>
    `tcgw_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${domain ? `; Domain=${domain}` : ''}`;

  // Clear with and without domain to ensure it works across all Vercel setups
  res.setHeader('Set-Cookie', [
    clearCookie(''),
    clearCookie('tcgwatchtower.com'),
  ]);
  res.redirect(307, '/portfolio');
}
