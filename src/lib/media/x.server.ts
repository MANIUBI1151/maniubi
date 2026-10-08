import { extFromUrl, followRedirects, UA_DESKTOP, UserError } from "./http.server";
import { hostIs } from "./link";
import type { InternalFormat, InternalMedia } from "./model";

const X_HOSTS = ["x.com", "twitter.com", "t.co", "fxtwitter.com", "vxtwitter.com", "fixupx.com"];

type Variant = { bitrate?: number; content_type?: string; url?: string };

type MediaDetail = {
  type?: string;
  media_url_https?: string;
  video_info?: { duration_millis?: number; variants?: Variant[] };
  original_info?: { width?: number; height?: number };
};

function resolution(url: string): { width: number | null; height: number | null } {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\//);
  if (!match) return { width: null, height: null };
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function resolveX(rawUrl: string): Promise<InternalMedia> {
  let current = rawUrl;
  const host = new URL(rawUrl).hostname;
  if (hostIs(host, ["t.co"])) {
    current = await followRedirects(rawUrl, (name) => hostIs(name, X_HOSTS), UA_DESKTOP);
  }
  const url = new URL(current);
  if (!hostIs(url.hostname, ["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"])) {
    throw new UserError("这不是一条 X 帖子链接");
  }
  const id = url.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) throw new UserError("这不是一条 X 帖子链接");

  const response = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh&token=x`,
    {
      headers: {
        "User-Agent": UA_DESKTOP,
        Accept: "application/json",
        Referer: "https://x.com/",
      },
      signal: AbortSignal.timeout(18_000),
    },
  );
  const text = await response.text();
  if (!text.startsWith("{")) throw new UserError("X 没有返回这条帖子，它可能不是公开的");
  const tweet = JSON.parse(text) as {
    text?: string;
    user?: { name?: string; screen_name?: string };
    mediaDetails?: MediaDetail[];
    video?: MediaDetail;
  };
  if (!tweet || tweet.text === undefined && !tweet.user) {
    throw new UserError("找不到这条帖子，或它不是公开内容");
  }
  const media = tweet.mediaDetails?.length
    ? tweet.mediaDetails
    : tweet.video
      ? [tweet.video]
      : [];
  const formats: InternalFormat[] = [];
  let durationSec: number | null = null;
  let videoIndex = 0;
  media.forEach((item, index) => {
    if (item.type === "video" || item.type === "animated_gif" || item.video_info) {
      videoIndex += 1;
      const variants = (item.video_info?.variants ?? [])
        .filter((variant) => variant.content_type === "video/mp4" && variant.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      variants.forEach((variant) => {
        const size = resolution(variant.url ?? "");
        const height = size.height;
        const labelCore = height ? `${height}P` : variant.bitrate ? `${Math.round((variant.bitrate ?? 0) / 1000)}kbps` : "视频";
        const prefix = media.filter((entry) => entry.video_info).length > 1 ? `视频${videoIndex} · ` : "";
        formats.push({
          id: `x-${videoIndex}-${variant.bitrate ?? index}-${height ?? 0}`,
          label: `${prefix}${labelCore}`,
          kind: "video",
          ext: "mp4",
          width: size.width,
          height,
          bytes: null,
          url: variant.url as string,
          referer: "https://x.com/",
        });
      });
      if (durationSec == null && item.video_info?.duration_millis) {
        durationSec = Math.round(item.video_info.duration_millis / 1000);
      }
      return;
    }
    if (item.media_url_https) {
      const photo = item.media_url_https.includes("?")
        ? item.media_url_https
        : `${item.media_url_https}?name=large`;
      formats.push({
        id: `img-${index + 1}`,
        label: `图片 ${formats.filter((entry) => entry.kind === "image").length + 1}`,
        kind: "image",
        ext: extFromUrl(photo, "jpg"),
        width: item.original_info?.width ?? null,
        height: item.original_info?.height ?? null,
        bytes: null,
        url: photo,
        referer: "https://x.com/",
      });
    }
  });
  if (!formats.length) throw new UserError("这条帖子里没有视频或图片");
  const authorName = tweet.user?.name ?? "";
  const handle = tweet.user?.screen_name ? `@${tweet.user.screen_name}` : "";
  const title = (tweet.text ?? "X 帖子").replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    public: {
      platform: "x",
      title: title || "X 帖子",
      author: [authorName, handle].filter(Boolean).join(" "),
      durationSec,
      source: `https://x.com/i/status/${id}`,
      formats: formats.map(({ url: _url, referer: _referer, ...rest }) => rest),
      parts: [],
      partIndex: null,
      note: null,
    },
    formats,
  };
}
