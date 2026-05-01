// api/giveaway/auth.js
// Handles Discord OAuth2 flow — redirects user to Discord, then exchanges code for token

export default async function handler(req, res) {
  const { code, state } = req.query;

  // Step 1: No code yet — redirect to Discord OAuth
  if (!code) {
    const isAdmin = req.query.admin === "1";
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: `${process.env.SITE_URL}/api/giveaway/auth`,
      response_type: "code",
      scope: "identify guilds.members.read",
      state: isAdmin ? "admin" : "enter",
    });
    return res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  }

  // Step 2: Exchange code for access token
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${process.env.SITE_URL}/api/giveaway/auth`,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("No access token");

    // Step 3: Fetch user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // Step 4: Fetch guild member info (for roles + join date)
    const memberRes = await fetch(
      `https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const member = await memberRes.json();

    // Build session payload
    const session = {
      userId: user.id,
      username: user.username,
      displayName: member.nick || user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || "0") % 5}.png`,
      joinedServer: member.joined_at || null,
      joinedDiscord: user.created_at || null,
      roles: member.roles || [],
      isPremium:
        Array.isArray(member.roles) &&
        member.roles.includes(process.env.PREMIUM_ROLE_ID || ""),
      accessToken: tokenData.access_token,
    };

    // Encode session as base64 and set cookie
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64");
    res.setHeader(
      "Set-Cookie",
      `gw_session=${encoded}; Path=/; SameSite=Lax; Max-Age=3600`
    );

    // Redirect based on state
    const dest = state === "admin" ? "/giveaway/admin" : "/giveaway";
    return res.redirect(dest);
  } catch (err) {
    console.error("OAuth error:", err);
    return res.redirect("/giveaway?error=auth_failed");
  }
}
