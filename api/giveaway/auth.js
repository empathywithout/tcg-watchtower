// api/giveaway/auth.js
// Handles Discord OAuth2 flow — redirects user to Discord, then exchanges code for token

const PREMIUM_MIN_DAYS = 7;

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

    // Step 4: Fetch guild member info (roles, join date, premium_since)
    const memberRes = await fetch(
      `https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const member = await memberRes.json();

    // Check if they have the Premium role
    const hasPremiumRole =
      Array.isArray(member.roles) &&
      member.roles.includes(process.env.PREMIUM_ROLE_ID || "");

    // Check how long they've been Premium using premium_since
    // Discord sets premium_since when a member boosts — but for custom roles
    // we fall back to checking role assignment via the member object.
    // Since Discord doesn't expose custom role assignment dates via this endpoint,
    // we use a workaround: fetch the member via the Bot token to get role timestamps.
    let premiumSince = null;
    let qualifiesAsPremium = false;

    if (hasPremiumRole && process.env.DISCORD_BOT_TOKEN) {
      try {
        const botMemberRes = await fetch(
          `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,
          { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );
        const botMember = await botMemberRes.json();

        // Use premium_since if available (server booster date)
        // Otherwise fall back to joined_at as a conservative estimate
        premiumSince = botMember.premium_since || null;

        if (premiumSince) {
          const daysSincePremium = (Date.now() - new Date(premiumSince).getTime()) / (1000 * 60 * 60 * 24);
          qualifiesAsPremium = daysSincePremium >= PREMIUM_MIN_DAYS;
        } else {
          // No premium_since means it's a manually assigned role — check joined_at
          // as a conservative proxy (if they've been in server 7+ days with the role)
          const joinedAt = botMember.joined_at || member.joined_at;
          if (joinedAt) {
            const daysSinceJoin = (Date.now() - new Date(joinedAt).getTime()) / (1000 * 60 * 60 * 24);
            qualifiesAsPremium = daysSinceJoin >= PREMIUM_MIN_DAYS;
          }
        }
      } catch (e) {
        console.error("Bot member fetch error:", e);
        // Fail safe — if bot fetch fails, use role presence only
        qualifiesAsPremium = hasPremiumRole;
      }
    } else if (hasPremiumRole) {
      // No bot token — fall back to role presence only
      qualifiesAsPremium = hasPremiumRole;
    }

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
      isPremium: qualifiesAsPremium,
      hasPremiumRole,         // raw role presence (ignoring time check)
      premiumSince,           // when they got premium (if available)
      premiumMinDays: PREMIUM_MIN_DAYS,
    };

    // Encode session as base64 and set cookie
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64");
    res.setHeader(
      "Set-Cookie",
      `gw_session=${encoded}; Path=/; SameSite=Lax; Max-Age=3600`
    );

    const dest = state === "admin" ? "/giveaway/admin" : "/giveaway";
    return res.redirect(dest);
  } catch (err) {
    console.error("OAuth error:", err);
    return res.redirect("/giveaway?error=auth_failed");
  }
}
