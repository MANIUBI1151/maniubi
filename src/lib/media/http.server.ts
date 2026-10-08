import { hostIs, isBlockedHost } from "./link";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export function assertPublicHttp(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError("这不是一条有效的链接");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("只支持 http 或 https 链接");
  }
  if (isBlockedHost(url.hostname)) throw new UserError("这个地址不能访问");
  return url;
}

export async function followRedirects(
  start: string,
  allow: (hostname: string) => boolean,
  ua: string,
): Promise<string> {
  let current = start;
  for (let hop = 0; hop < 6; hop += 1) {
    const url = assertPublicHttp(current);
    if (!allow(url.hostname)) throw new UserError("链接跳转到了不受支持的地址");
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": ua, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.arrayBuffer().catch(() => undefined);
      if (!location) throw new UserError("短链无法展开，请换一条分享链接");
      current = new URL(location, current).href;
      continue;
    }
    await response.arrayBuffer().catch(() => undefined);
    return current;
  }
  throw new UserError("短链跳转次数过多");
}

const MEDIA_HOSTS = [
  "bilivideo.com",
  "bilivideo.cn",
  "hdslb.com",
  "bilibili.com",
  "video.twimg.com",
  "pbs.twimg.com",
  "twimg.com",
  "douyinvod.com",
  "douyinpic.com",
  "douyinstatic.com",
  "douyin.com",
  "iesdouyin.com",
  "zjcdn.com",
  "byteimg.com",
  "ibyteimg.com",
  "snssdk.com",
  "amemv.com",
  "douyincdn.com",
  "bytecdn.cn",
  "bytecdn.com",
  "365yg.com",
  "ixigua.com",
  "bytetos.com",
  "pstatp.com",
  "ipstatp.com",
];

export function assertMediaUrl(raw: string): URL {
  const url = assertPublicHttp(raw);
  if (url.protocol !== "https:") throw new UserError("下载地址不是安全链接");
  if (!hostIs(url.hostname, MEDIA_HOSTS)) throw new UserError("下载地址不在受支持的来源里");
  return url;
}

export function extFromUrl(raw: string, fallback: string): string {
  try {
    const match = new URL(raw).pathname.match(/\.([a-z0-9]{2,4})$/i);
    if (!match) return fallback;
    const ext = match[1].toLowerCase();
    if (ext === "jpeg") return "jpg";
    if (["mp4", "jpg", "png", "webp", "gif", "mp3", "m4a"].includes(ext)) return ext;
  } catch {
    /* ignore malformed CDN urls */
  }
  return fallback;
}

export function fileName(title: string, ext: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|#\n\r\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video";
  return `${base}.${ext}`;
}

export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
