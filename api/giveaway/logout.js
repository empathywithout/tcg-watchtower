// api/giveaway/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie', 'gw_session=; Path=/; HttpOnly; Max-Age=0');
  res.redirect('/giveaway');
}
