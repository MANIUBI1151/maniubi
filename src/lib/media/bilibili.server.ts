import { followRedirects, UA_DESKTOP, UserError, extFromUrl } from "./http.server";
import { hostIs } from "./link";
import type { InternalFormat, InternalMedia } from "./model";

const BILI_HOSTS = ["bilibili.com", "b23.tv", "b23.wtf", "bili2233.cn", "acg.tv"];

const QN_LIST = [80, 64, 32, 16];

const QN_LABEL: Record<number, string> = {
  6: "240P",
  16: "360P",
  32: "480P",
  64: "720P",
  74: "720P60",
  80: "1080P",
  112: "1080P+",
  116: "1080P60",
  120: "4K",
};

type BiliPage = { cid: number; page: number; part: string; duration: number };

function biliHeaders(referer: string): HeadersInit {
  return {
    "User-Agent": UA_DESKTOP,
    Referer: referer,
    Accept: "application/json",
  };
}

async function biliJson(url: string, referer: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: biliHeaders(referer),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new UserError("B 站没有响应，请稍后再试");
  return (await response.json()) as Record<string, unknown>;
}

async function playFormats(args: {
  cid: number;
  bvid?: string;
  aid?: string;
  epId?: number;
  referer: string;
}): Promise<InternalFormat[]> {
  const found = new Map<number, InternalFormat>();
  await Promise.all(
    QN_LIST.map(async (qn) => {
      const params = new URLSearchParams({
        cid: String(args.cid),
        qn: String(qn),
        fnval: "1",
        fnver: "0",
        platform: "html5",
        high_quality: "1",
      });
      if (args.bvid) params.set("bvid", args.bvid);
      if (args.aid) params.set("avid", args.aid);
      if (args.epId) params.set("ep_id", String(args.epId));
      const endpoint = args.epId
        ? `https://api.bilibili.com/pgc/player/web/playurl?${params}`
        : `https://api.bilibili.com/x/player/playurl?${params}`;
      try {
        const json = await biliJson(endpoint, args.referer);
        if (json.code !== 0) return;
        const root = (json.result ?? json.data) as
          | {
              quality?: number;
              durl?: { url?: string; size?: number }[];
            }
          | undefined;
        const quality = root?.quality;
        const clip = root?.durl?.[0];
        if (!quality || !clip?.url || (root?.durl?.length ?? 0) !== 1) return;
        if (found.has(quality)) return;
        const url = clip.url.startsWith("http://") ? `https://${clip.url.slice(7)}` : clip.url;
        found.set(quality, {
          id: `bili-${quality}`,
          label: QN_LABEL[quality] ?? `${quality}`,
          kind: "video",
          ext: extFromUrl(url, "mp4"),
          width: null,
          height: null,
          bytes: typeof clip.size === "number" ? clip.size : null,
          url,
          referer: args.referer,
        });
      } catch {
        /* one quality failing should not hide the others */
      }
    }),
  );
  return [...found.values()].sort((a, b) => Number(b.id.slice(5)) - Number(a.id.slice(5)));
}

function httpsPic(pic: unknown): string | null {
  if (typeof pic !== "string" || !pic) return null;
  if (pic.startsWith("//")) return `https:${pic}`;
  if (pic.startsWith("http://")) return `https://${pic.slice(7)}`;
  return pic.startsWith("https://") ? pic : null;
}

export async function resolveBilibili(rawUrl: string, part: number | null): Promise<InternalMedia> {
  const start = new URL(rawUrl);
  const landed = hostIs(start.hostname, ["bilibili.com"])
    ? rawUrl
    : await followRedirects(rawUrl, (host) => hostIs(host, BILI_HOSTS), UA_DESKTOP);
  const url = new URL(landed);
  if (!hostIs(url.hostname, ["bilibili.com"])) {
    throw new UserError("这条短链没有打开到 B 站视频");
  }
  const epMatch = url.pathname.match(/\/bangumi\/play\/ep(\d+)/);
  const ssMatch = url.pathname.match(/\/bangumi\/play\/ss(\d+)/);
  if (epMatch || ssMatch) {
    return resolvePgc(epMatch?.[1] ?? null, ssMatch?.[1] ?? null, part);
  }
  const bvMatch = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
  const avMatch = url.pathname.match(/\/video\/av(\d+)/i);
  if (!bvMatch && !avMatch) throw new UserError("这不是一条 B 站视频链接");

  const viewParams = bvMatch ? `bvid=${bvMatch[1]}` : `aid=${avMatch?.[1]}`;
  const view = await biliJson(
    `https://api.bilibili.com/x/web-interface/view?${viewParams}`,
    "https://www.bilibili.com",
  );
  if (view.code !== 0) {
    const message = typeof view.message === "string" ? view.message : "";
    if (message.includes("不可见") || view.code === 62002) {
      throw new UserError("这个稿件不可见，可能已删除或需要登录");
    }
    throw new UserError("找不到这个 B 站视频");
  }
  const data = view.data as {
    bvid?: string;
    aid?: number;
    title?: string;
    pic?: string;
    duration?: number;
    owner?: { name?: string };
    pages?: BiliPage[];
  };
  const pages = data.pages ?? [];
  const requested = part ?? Number(url.searchParams.get("p") || "1");
  const page = pages.find((item) => item.page === requested) ?? (requested === 1 ? pages[0] : undefined);
  if (!page) throw new UserError("没有这一分 P");
  const bvid = data.bvid ?? bvMatch?.[1];
  const referer = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : `https://www.bilibili.com/video/av${data.aid}`;
  const formats = await playFormats({
    cid: page.cid,
    bvid,
    aid: data.aid ? String(data.aid) : undefined,
    referer,
  });
  if (!formats.length) throw new UserError("B 站没有返回可下载的视频文件");
  const cover = httpsPic(data.pic);
  if (cover) {
    formats.push({
      id: "cover",
      label: "封面",
      kind: "image",
      ext: extFromUrl(cover, "jpg"),
      width: null,
      height: null,
      bytes: null,
      url: cover,
      referer: "https://www.bilibili.com",
    });
  }
  const source = bvid
    ? `https://www.bilibili.com/video/${bvid}${page.page > 1 ? `?p=${page.page}` : ""}`
    : referer;
  const best = Number(formats.find((item) => item.kind === "video")?.id.slice(5) ?? 0);
  return {
    public: {
      platform: "bilibili",
      title: pages.length > 1 ? `${data.title ?? "B站视频"} · ${page.part}` : (data.title ?? "B站视频"),
      author: data.owner?.name ?? "",
      durationSec: page.duration || data.duration || null,
      source,
      formats: formats.map(strip),
      parts: pages.map((item) => ({ index: item.page, title: item.part || `P${item.page}` })),
      partIndex: page.page,
      note:
        best > 0 && best <= 32
          ? "当前只能拿到较低清晰度。更高画质通常需要登录或大会员。"
          : null,
    },
    formats,
  };
}

async function resolvePgc(epId: string | null, ssId: string | null, part: number | null): Promise<InternalMedia> {
  const query = epId ? `ep_id=${epId}` : `season_id=${ssId}`;
  const json = await biliJson(
    `https://api.bilibili.com/pgc/view/web/season?${query}`,
    "https://www.bilibili.com",
  );
  if (json.code !== 0) throw new UserError("找不到这个番剧或影视");
  const result = json.result as {
    title?: string;
    cover?: string;
    episodes?: {
      id: number;
      cid: number;
      title?: string;
      long_title?: string;
      cover?: string;
      duration?: number;
      badge?: string;
    }[];
  };
  const episodes = result.episodes ?? [];
  if (!episodes.length) throw new UserError("这一季没有可播放的正片");
  const chosen =
    (part ? episodes[part - 1] : undefined) ??
    (epId ? episodes.find((item) => String(item.id) === epId) : undefined) ??
    episodes[0];
  if (!chosen) throw new UserError("没有这一集");
  const referer = `https://www.bilibili.com/bangumi/play/ep${chosen.id}`;
  const formats = await playFormats({ cid: chosen.cid, epId: chosen.id, referer });
  if (!formats.length) throw new UserError("这一集没有公开的视频文件，可能需要大会员");
  const cover = httpsPic(chosen.cover) ?? httpsPic(result.cover);
  if (cover) {
    formats.push({
      id: "cover",
      label: "封面",
      kind: "image",
      ext: extFromUrl(cover, "jpg"),
      width: null,
      height: null,
      bytes: null,
      url: cover,
      referer: "https://www.bilibili.com",
    });
  }
  const epTitle = [chosen.title, chosen.long_title].filter(Boolean).join(" ");
  const best = Number(formats.find((item) => item.kind === "video")?.id.slice(5) ?? 0);
  return {
    public: {
      platform: "bilibili",
      title: `${result.title ?? "番剧"} · ${epTitle || "正片"}`,
      author: "哔哩哔哩",
      durationSec: chosen.duration ? Math.round(chosen.duration / 1000) : null,
      source: referer,
      formats: formats.map(strip),
      parts: episodes.map((item, index) => ({
        index: index + 1,
        title: [item.title, item.long_title].filter(Boolean).join(" ") || `第${index + 1}集`,
      })),
      partIndex: episodes.indexOf(chosen) + 1,
      note:
        best > 0 && best <= 32
          ? "番剧的高清晰度通常需要大会员。这里只提供当前公开能取到的画质。"
          : chosen.badge
            ? `这一集标记为「${chosen.badge}」。若下载失败，可能需要登录对应权益。`
            : null,
    },
    formats,
  };
}

function strip(format: InternalFormat) {
  return {
    id: format.id,
    label: format.label,
    kind: format.kind,
    ext: format.ext,
    width: format.width,
    height: format.height,
    bytes: format.bytes,
  };
}
