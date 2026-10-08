import { extFromUrl, UA_DESKTOP, UA_MOBILE, UserError, assertPublicHttp } from "./http.server";
import { hostIs, isBlockedHost } from "./link";
import type { InternalFormat, InternalMedia } from "./model";

const DOUYIN_HOSTS = ["douyin.com", "iesdouyin.com"];
const REFERER = "https://www.douyin.com/";

let ttwidCache: { value: string; exp: number } | null = null;

function idFrom(input: string): string | null {
  try {
    const url = new URL(input);
    const path = url.pathname.match(/\/(?:video|note|share\/video)\/(\d{8,22})/);
    if (path) return path[1];
    for (const key of ["modal_id", "aweme_id", "item_id"]) {
      const value = url.searchParams.get(key);
      if (value && /^\d{8,22}$/.test(value)) return value;
    }
  } catch {
    /* not a url */
  }
  return null;
}

async function douyinId(start: string): Promise<{ id: string; note: boolean }> {
  const direct = idFrom(start);
  if (direct) return { id: direct, note: /\/note\//.test(start) };
  let current = start;
  for (let hop = 0; hop < 6; hop += 1) {
    const url = assertPublicHttp(current);
    if (isBlockedHost(url.hostname) || !hostIs(url.hostname, DOUYIN_HOSTS)) {
      throw new UserError("链接跳转到了不受支持的地址");
    }
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": UA_MOBILE, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.arrayBuffer().catch(() => undefined);
      if (!location) break;
      current = new URL(location, current).href;
      const id = idFrom(current);
      if (id) return { id, note: /\/note\//.test(current) };
      continue;
    }
    const html = await response.text();
    const id =
      idFrom(current) ||
      html.match(/\/(?:video|note)\/(\d{15,22})/)?.[1] ||
      html.match(/modal_id=(\d{15,22})/)?.[1] ||
      null;
    if (id) return { id, note: /\/note\//.test(current) || html.includes("/note/") };
    break;
  }
  throw new UserError("没能从这条抖音链接里找到作品。请用 App 分享里复制的链接。");
}

async function getTtwid(): Promise<string> {
  if (ttwidCache && ttwidCache.exp > Date.now()) return ttwidCache.value;
  const response = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA_DESKTOP },
    body: JSON.stringify({
      region: "cn",
      aid: 6383,
      needFid: false,
      service: "www.douyin.com",
      migrate_info: { ticket: "", source: "node" },
      cbUrlProtocol: "https",
      union: true,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  const joined = cookies.length ? cookies.join("\n") : (response.headers.get("set-cookie") ?? "");
  await response.arrayBuffer().catch(() => undefined);
  const match = joined.match(/ttwid=([^;\s]+)/);
  if (!match) throw new UserError("抖音暂时无法建立访问，请稍后再试");
  ttwidCache = { value: match[1], exp: Date.now() + 30 * 60 * 1000 };
  return match[1];
}

type PlayAddr = {
  url_list?: string[];
  width?: number;
  height?: number;
  data_size?: number;
};

function pickUrl(list: string[] | undefined): string | null {
  if (!list?.length) return null;
  const https = list
    .filter((item) => item.startsWith("https://"))
    .map((item) => item.replace("/playwm/", "/play/"));
  return (
    https.find((item) => {
      try {
        return new URL(item).hostname !== "www.douyin.com";
      } catch {
        return false;
      }
    }) ??
    https[0] ??
    null
  );
}

type BitRate = {
  bit_rate?: number;
  gear_name?: string;
  is_h265?: boolean | number;
  is_bytevc1?: boolean | number;
  play_addr?: PlayAddr;
};

function videoFormats(video: {
  duration?: number;
  play_addr?: PlayAddr;
  bit_rate?: BitRate[];
  cover?: { url_list?: string[] };
  origin_cover?: { url_list?: string[] };
}): { formats: InternalFormat[]; durationSec: number | null; cover: string | null } {
  const formats: InternalFormat[] = [];
  const grouped = new Map<
    string,
    { width: number; height: number; bitrate: number; bytes: number; url: string; h265: boolean }
  >();
  for (const item of video.bit_rate ?? []) {
    const url = pickUrl(item.play_addr?.url_list);
    if (!url) continue;
    const width = item.play_addr?.width || 0;
    const height = item.play_addr?.height || 0;
    const key = `${width}x${height}`;
    const h265 = Boolean(item.is_h265 || item.is_bytevc1);
    const next = {
      width,
      height,
      bitrate: item.bit_rate || 0,
      bytes: item.play_addr?.data_size || 0,
      url,
      h265,
    };
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, next);
      continue;
    }
    const betterCodec = prev.h265 && !next.h265;
    const worseCodec = !prev.h265 && next.h265;
    if (betterCodec || (!worseCodec && next.bitrate > prev.bitrate)) grouped.set(key, next);
  }
  const ranked = [...grouped.values()].sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
  for (const item of ranked) {
    const label = item.height >= 2160 ? "4K" : item.height > 0 ? `${item.height}P` : "视频";
    formats.push({
      id: `v-${item.width}x${item.height}`,
      label: item.h265 ? `${label} · H.265` : label,
      kind: "video",
      ext: "mp4",
      width: item.width || null,
      height: item.height || null,
      bytes: item.bytes || null,
      url: item.url,
      referer: REFERER,
    });
  }
  if (!formats.length) {
    const url = pickUrl(video.play_addr?.url_list);
    if (url) {
      formats.push({
        id: "v-main",
        label: "视频",
        kind: "video",
        ext: "mp4",
        width: video.play_addr?.width || null,
        height: video.play_addr?.height || null,
        bytes: video.play_addr?.data_size || null,
        url,
        referer: REFERER,
      });
    }
  }
  const durationSec =
    typeof video.duration === "number" && video.duration > 0 ? Math.round(video.duration / 1000) : null;
  const cover = pickUrl(video.origin_cover?.url_list) ?? pickUrl(video.cover?.url_list);
  return { formats, durationSec, cover };
}

export async function resolveDouyin(rawUrl: string): Promise<InternalMedia> {
  const { id } = await douyinId(rawUrl);
  const ttwid = await getTtwid();
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
  endpoint.search = new URLSearchParams({
    aweme_id: id,
    aid: "6383",
    version_name: "23.5.0",
    device_platform: "webapp",
    os_version: "10",
    channel: "channel_pc_web",
    pc_client_type: "1",
  }).toString();
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": UA_DESKTOP,
      Referer: `https://www.douyin.com/video/${id}`,
      Cookie: `ttwid=${ttwid}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new UserError("抖音没有响应，请稍后再试");
  const json = (await response.json()) as {
    status_code?: number;
    aweme_detail?: {
      desc?: string;
      author?: { nickname?: string };
      images?: { url_list?: string[]; download_url_list?: string[] }[] | null;
      music?: { play_url?: { url_list?: string[] } };
      video?: Parameters<typeof videoFormats>[0];
    } | null;
    filter_detail?: { filter_reason?: string };
  };
  const detail = json.aweme_detail;
  if (!detail) {
    const reason = json.filter_detail?.filter_reason;
    if (reason === "core_dep") throw new UserError("这条作品不存在，或已经删除");
    throw new UserError("这条抖音作品不是公开可看的，可能是私密或需要登录");
  }
  const video = detail.video ? videoFormats(detail.video) : { formats: [], durationSec: null, cover: null };
  const formats = [...video.formats];
  const images = detail.images ?? [];
  images.forEach((image, index) => {
    const url = pickUrl(image.download_url_list) ?? pickUrl(image.url_list);
    if (!url) return;
    formats.push({
      id: `img-${index + 1}`,
      label: `图片 ${index + 1}`,
      kind: "image",
      ext: extFromUrl(url, "jpg"),
      width: null,
      height: null,
      bytes: null,
      url,
      referer: REFERER,
    });
  });
  const audio = pickUrl(detail.music?.play_url?.url_list);
  if (audio && formats.some((item) => item.kind === "video")) {
    formats.push({
      id: "audio",
      label: "原声",
      kind: "audio",
      ext: extFromUrl(audio, "mp3"),
      width: null,
      height: null,
      bytes: null,
      url: audio,
      referer: REFERER,
    });
  }
  if (video.cover) {
    formats.push({
      id: "cover",
      label: "封面",
      kind: "image",
      ext: extFromUrl(video.cover, "jpg"),
      width: null,
      height: null,
      bytes: null,
      url: video.cover,
      referer: REFERER,
    });
  }
  if (!formats.some((item) => item.kind === "video" || item.kind === "image" && item.id !== "cover")) {
    throw new UserError("这条抖音作品没有可下载的视频或图片");
  }
  const source = images.length && !formats.some((item) => item.kind === "video")
    ? `https://www.douyin.com/note/${id}`
    : `https://www.douyin.com/video/${id}`;
  return {
    public: {
      platform: "douyin",
      title: (detail.desc || "抖音作品").trim().slice(0, 140),
      author: detail.author?.nickname ?? "",
      durationSec: video.durationSec,
      source,
      formats: formats.map(({ url: _url, referer: _referer, ...rest }) => rest),
      parts: [],
      partIndex: null,
      note: "画质取决于抖音公开返回的文件。会员、私密或已删除的作品无法解析。",
    },
    formats,
  };
}
