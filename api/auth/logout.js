// api/auth/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie', 'tcgw_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.redirect('/portfolio.html');
}
