const BOT_UA_REGEX =
  /facebookexternalhit|facebot|meta-externalfetcher|Twitterbot|LinkedInBot|Slackbot|TelegramBot|WhatsApp|Discordbot|Googlebot|bingbot|Applebot/i;

const OG_PROXY_BASE =
  "https://zimpimoierpsocnmnizm.supabase.co/functions/v1/og-proxy";

export default async (request: Request, context: any) => {
  const ua = request.headers.get("user-agent") || "";

  if (!BOT_UA_REGEX.test(ua)) {
    return context.next();
  }

  const url = new URL(request.url);
  const path = url.pathname + url.search;
  const proxyUrl = `${OG_PROXY_BASE}?path=${encodeURIComponent(path)}`;

  // Forward Accept-Language so OG proxy can detect Romanian bots
  const acceptLang = request.headers.get("accept-language") || "";

  try {
    const res = await fetch(proxyUrl, {
      method: "GET",
      headers: {
        "User-Agent": ua,
        "Accept-Language": acceptLang,
      },
    });

    const headers = new Headers(res.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
    headers.set("X-OG-Rewrite", "1");

    return new Response(res.body, { status: res.status, headers });
  } catch (_err) {
    return context.next();
  }
};
