/**
 * Cloudflare Worker: Telegram Web Preview Proxy Scraper
 * Added: JSON Structure formatting, Telegram Bot Integration for Meta configs (Title, Desc, Link, Image, Ads Status) via KV
 */

const _0x1a2b = "cHJveHlEb3RBcHA="; 
const getCoreCh = () => atob(_0x1a2b);

const DEFAULT_CONFIG = {
  HARDCODED_DEFAULT_CHANNEL: getCoreCh(),
  MAX_POSTS: 10,
  MAX_PROXIES: 50,
  CACHE_TTL: 60,
  FALLBACK_ENDPOINT: "",
  META_DEFAULTS: {
    title: "لیست پروکسی‌های تلگرام",
    description: "پروکسی‌های قدرتمند و بروز",
    link: "https://t.me/ProxyMTProto",
    image: "https://github.com/proxyDotApp/telegram-proxy-scraper/blob/main/photo.jpg", // لینک عکس پیش‌فرض
    show_ads: false // وضعیت پیش‌فرض نمایش تبلیغات (true = فعال، false = غیرفعال)
  }
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    // هندل کردن درخواست POST برای وب‌هوک ربات تلگرام
    if (request.method === "POST") {
      return await handleBotWebhook(request, env);
    }

    if (request.method !== "GET") {
      return jsonResponse({ status: false, error: "Method Not Allowed" }, 405);
    }

    const coreTarget = DEFAULT_CONFIG.HARDCODED_DEFAULT_CHANNEL === atob("cHJveHlEb3RBcHA=") 
        ? DEFAULT_CONFIG.HARDCODED_DEFAULT_CHANNEL 
        : atob("cHJveHlEb3RBcHA=");

    try {
      const url = new URL(request.url);

      const maxPosts = parseInt(url.searchParams.get("posts") || env.MAX_POSTS || DEFAULT_CONFIG.MAX_POSTS, 10);
      const maxProxies = parseInt(url.searchParams.get("limit") || env.MAX_PROXIES || DEFAULT_CONFIG.MAX_PROXIES, 10);

      // استخراج کانال‌های درخواستی از ورودی
      const channelParam = url.searchParams.get("channel");
      const requestedChannels = channelParam
        ? channelParam.split(",").map((c) => c.trim().replace(/^@/, "")).filter(Boolean)
        : [];

      // دریافت همزمان اطلاعات از KV و پروکسی‌ها (برای سرعت بیشتر)
      const kvTitlePromise = env.META_KV ? env.META_KV.get("title") : Promise.resolve(null);
      const kvDescPromise = env.META_KV ? env.META_KV.get("description") : Promise.resolve(null);
      const kvLinkPromise = env.META_KV ? env.META_KV.get("link") : Promise.resolve(null);
      const kvImagePromise = env.META_KV ? env.META_KV.get("image") : Promise.resolve(null);
      const kvAdsPromise = env.META_KV ? env.META_KV.get("show_ads") : Promise.resolve(null); 

      
      const defaultProxiesPromise = getChannelProxiesWithFallback(coreTarget, maxPosts, maxProxies, env);

      const requestedProxiesPromises = Promise.allSettled(
        requestedChannels.map((channel) => getChannelProxiesWithFallback(channel, maxPosts, maxProxies, env))
      );

      const [titleVal, descVal, linkVal, imageVal, adsVal, rawDefaultProxies, reqSettled] = await Promise.all([
        kvTitlePromise,
        kvDescPromise,
        kvLinkPromise,
        kvImagePromise,
        kvAdsPromise,
        defaultProxiesPromise,
        requestedProxiesPromises
      ]);

      // پردازش پروکسی‌های ورودی (حذف تکراری‌ها و اعمال محدودیت)
      const defaultProxies = processAndDeduplicate(rawDefaultProxies, maxProxies);
      
      let rawRequested = [];
      for (const res of reqSettled) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          rawRequested.push(...res.value);
        }
      }
      const channelsProxies = processAndDeduplicate(rawRequested, maxProxies);

      // تبدیل مقدار استرینگ دریافت شده از KV به Boolean
      const showAds = adsVal !== null ? (adsVal === "true") : DEFAULT_CONFIG.META_DEFAULTS.show_ads;

      // ساخت آبجکت نهایی با اضافه شدن کلید show_ads
      const finalResponse = {
        show_ads: showAds,
        default: defaultProxies,
        channels: channelsProxies,
        title: titleVal || DEFAULT_CONFIG.META_DEFAULTS.title,
        description: descVal || DEFAULT_CONFIG.META_DEFAULTS.description,
        link: linkVal || DEFAULT_CONFIG.META_DEFAULTS.link,
        image: imageVal || DEFAULT_CONFIG.META_DEFAULTS.image
      };

      return jsonResponse(finalResponse, 200);

    } catch (err) {
      return jsonResponse({ status: false, error: "Internal Server Error", message: err.message }, 500);
    }
  },
};

/**
 * پردازش درخواست‌های ربات تلگرام (وب‌هوک)
 */
async function handleBotWebhook(request, env) {
  try {
    const update = await request.json();
    const msg = update.message;
    
    // اگر پیام متنی نبود یا از طرف کاربر نامعتبر بود، نادیده بگیر
    if (!msg || !msg.text) return new Response("OK", { status: 200 });
    
    const adminId = parseInt(env.ADMIN_ID);
    if (!adminId || msg.from.id !== adminId) {
      return new Response("Unauthorized", { status: 200 }); // برگرداندن 200 برای جلوگیری از تلاش مجدد تلگرام
    }

    const text = msg.text.trim();
    let replyMessage = "دستور نامشخص! از دستورات زیر استفاده کنید:\n\n/title [متن]\n/desc [متن]\n/link [لینک]\n/image [لینک عکس]\n/ads [on/off]";

    if (text.startsWith("/title ")) {
      const newTitle = text.replace("/title ", "").trim();
      if (env.META_KV) await env.META_KV.put("title", newTitle);
      replyMessage = `✅ عنوان با موفقیت تغییر کرد به:\n${newTitle}`;
    } else if (text.startsWith("/desc ")) {
      const newDesc = text.replace("/desc ", "").trim();
      if (env.META_KV) await env.META_KV.put("description", newDesc);
      replyMessage = `✅ توضیحات با موفقیت تغییر کرد به:\n${newDesc}`;
    } else if (text.startsWith("/link ")) {
      const newLink = text.replace("/link ", "").trim();
      if (env.META_KV) await env.META_KV.put("link", newLink);
      replyMessage = `✅ لینک با موفقیت تغییر کرد به:\n${newLink}`;
    } else if (text.startsWith("/image ")) {
      const newImage = text.replace("/image ", "").trim();
      if (env.META_KV) await env.META_KV.put("image", newImage);
      replyMessage = `✅ لینک عکس با موفقیت تغییر کرد به:\n${newImage}`;
    } else if (text.startsWith("/ads ")) {
      const adsCommand = text.replace("/ads ", "").trim().toLowerCase();
      if (adsCommand === "on" || adsCommand === "true") {
        if (env.META_KV) await env.META_KV.put("show_ads", "true");
        replyMessage = `✅ نمایش تبلیغات در اپلیکیشن فعال شد.`;
      } else if (adsCommand === "off" || adsCommand === "false") {
        if (env.META_KV) await env.META_KV.put("show_ads", "false");
        replyMessage = `🚫 نمایش تبلیغات در اپلیکیشن غیرفعال شد.`;
      } else {
        replyMessage = `⚠️ مقدار نامعتبر! برای وضعیت تبلیغات فقط از on یا off استفاده کنید.\nمثال: /ads off`;
      }
    }

    // ارسال پاسخ به ادمین در تلگرام
    if (env.BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, text: replyMessage })
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    return new Response("Error Processing Webhook", { status: 500 });
  }
}

/**
 * پاک‌سازی، بررسی یکتایی و اعمال سقف تعداد روی آرایه پروکسی‌ها
 */
function processAndDeduplicate(proxiesList, maxProxies) {
  if (!Array.isArray(proxiesList)) return [];
  const extracted = [];
  const seen = new Set();

  for (const proxy of proxiesList) {
    if (!proxy || !proxy.server || !proxy.port || !proxy.secret) continue;
    const uniqueKey = `${proxy.server}:${proxy.port}:${proxy.secret}`;
    if (!seen.has(uniqueKey)) {
      seen.add(uniqueKey);
      extracted.push({
        server: proxy.server,
        port: Number(proxy.port),
        secret: proxy.secret,
      });
      if (maxProxies > 0 && extracted.length >= maxProxies) {
        break;
      }
    }
  }
  return extracted;
}

// ============================================================================
// توابع مربوط به دریافت پروکسی (بدون تغییر منطق اصلی، فقط جابجایی ساختاری)
// ============================================================================

async function getChannelProxiesWithFallback(channelName, maxPosts, maxProxies, env) {
  if (!channelName) return [];
  try {
    const proxies = await scrapeChannel(channelName, maxPosts, env);
    if (Array.isArray(proxies) && proxies.length > 0) return proxies;
  } catch (err) {
    // خطا نادیده گرفته می‌شود تا فال‌بک اجرا شود
  }
  return await fetchFromFallback(channelName, maxPosts, maxProxies, env);
}

async function fetchFromFallback(channelName, maxPosts, maxProxies, env) {
  try {
    const cleanChannel = channelName.replace(/[^a-zA-Z0-9_]/g, "");
    if (!cleanChannel) return [];

    const baseUrl = env.FALLBACK_ENDPOINT || DEFAULT_CONFIG.FALLBACK_ENDPOINT;
    const fallbackUrl = new URL(baseUrl);
    fallbackUrl.searchParams.set("channel", `@${cleanChannel}`);
    fallbackUrl.searchParams.set("posts", String(maxPosts));
    fallbackUrl.searchParams.set("limit", String(maxProxies));

    const cacheTtl = parseInt(env.CACHE_TTL || DEFAULT_CONFIG.CACHE_TTL, 10);
    const response = await fetch(fallbackUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Cloudflare-Worker-Fallback/1.0",
      },
      cf: { cacheTtl, cacheEverything: true },
    });

    if (!response.ok) return [];
    const data = await response.json();

    return Array.isArray(data) ? data
      : Array.isArray(data?.proxies) ? data.proxies
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.result) ? data.result
      : [];
  } catch {
    return [];
  }
}

async function scrapeChannel(channelName, maxPosts, env) {
  const cleanChannel = channelName.replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleanChannel) return [];

  const targetUrl = `https://t.me/s/${cleanChannel}`;
  const cacheTtl = parseInt(env.CACHE_TTL || DEFAULT_CONFIG.CACHE_TTL, 10);

  const response = await fetch(targetUrl, {
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cf: { cacheTtl, cacheEverything: true },
  });

  if (response.status >= 300 && response.status < 400) throw new Error("Redirected");
  if (!response.ok) throw new Error("Failed to fetch");

  const posts = [];
  let currentPostProxies = null;
  let currentTextBuffer = "";

  const rewriter = new HTMLRewriter()
    .on(".tgme_widget_message", {
      element(el) {
        if (currentPostProxies !== null && currentTextBuffer) extractFromRawText(currentTextBuffer, currentPostProxies);
        currentPostProxies = [];
        currentTextBuffer = "";
        posts.push(currentPostProxies);
      },
    })
    .on(".tgme_widget_message a[href]", {
      element(el) {
        if (!currentPostProxies) return;
        const href = el.getAttribute("href");
        if (href) {
          const parsed = parseProxyUrl(href);
          if (parsed) currentPostProxies.push(parsed);
        }
      },
    })
    .on(".tgme_widget_message_text", {
      text(textChunk) {
        if (currentPostProxies !== null) {
          currentTextBuffer += textChunk.text;
          if (textChunk.lastInTextNode) currentTextBuffer += " ";
        }
      },
    });

  await rewriter.transform(response).arrayBuffer();
  if (currentPostProxies !== null && currentTextBuffer) extractFromRawText(currentTextBuffer, currentPostProxies);

  return posts.filter((p) => p.length > 0).slice(-maxPosts).reverse().flat();
}

function extractFromRawText(rawText, targetArray) {
  const cleanText = rawText.replace(/&amp;/g, "&");
  const regex = /(?:https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/proxy\?|tg:\/\/proxy\?)[^\s"'<>`]+/gi;
  const matches = cleanText.match(regex);
  if (matches) {
    for (const match of matches) {
      const parsed = parseProxyUrl(match);
      if (parsed) targetArray.push(parsed);
    }
  }
}

function parseProxyUrl(rawUrl) {
  try {
    let normalized = rawUrl.trim();
    while (normalized.includes("&amp;") || normalized.includes("&#38;")) {
      normalized = normalized.replace(/&amp;/gi, "&").replace(/&#38;/gi, "&");
    }
    normalized = normalized.replace(/^tg:\/\/proxy\?/i, "https://t.me/proxy?");
    if (!/^https?:\/\/(t\.me|telegram\.me|telegram\.dog)\/proxy\?/i.test(normalized)) return null;

    const urlObj = new URL(normalized);
    const server = (urlObj.searchParams.get("server") || "").trim();
    const portStr = (urlObj.searchParams.get("port") || "").trim();
    let secret = (urlObj.searchParams.get("secret") || "").trim();

    if (!server || !portStr || !secret) return null;
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) return null;
    if (!/^[a-zA-Z0-9.-]+$/.test(server)) return null;
    secret = secret.replace(/[^a-zA-Z0-9+/=_~-]/g, "");
    if (secret.length < 16) return null;

    return { server, port, secret };
  } catch {
    return null;
  }
}

function jsonResponse(data, status = 200) {
  const hasData = (data.default && data.default.length > 0) || (data.channels && data.channels.length > 0);
  
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": hasData ? "public, max-age=60" : "no-store",
    },
  });
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}