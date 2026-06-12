// api/auth/_verify.js
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function verifySession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/tcgw_session=([^;]+)/);
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], SECRET);
    return payload;
  } catch {
    return null;
  }
}
