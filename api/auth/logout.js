// api/auth/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie', [
    'tcgw_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]);
  res.redirect('/portfolio');
}
