import { resolveBilibili } from "./bilibili.server";
import { resolveDouyin } from "./douyin.server";
import { UserError, assertPublicHttp } from "./http.server";
import { extractHttpUrl, platformOf } from "./link";
import type { InternalFormat, InternalMedia } from "./model";
import type { ResolvedMedia } from "./types";
import { resolveX } from "./x.server";

const cache = new Map<string, { at: number; media: InternalMedia }>();
const TTL_MS = 10 * 60 * 1000;

async function resolveInternal(text: string, part: number | null): Promise<InternalMedia> {
  const extracted = extractHttpUrl(text);
  if (!extracted) throw new UserError("请粘贴包含链接的分享内容");
  const url = assertPublicHttp(extracted);
  const platform = platformOf(url.hostname);
  if (!platform) throw new UserError("目前只支持 B 站、抖音和 X 的公开链接");
  const media =
    platform === "bilibili"
      ? await resolveBilibili(url.href, part)
      : platform === "douyin"
        ? await resolveDouyin(url.href)
        : await resolveX(url.href);
  cache.set(media.public.source, { at: Date.now(), media });
  return media;
}

export async function resolvePublic(text: string, part: number | null): Promise<ResolvedMedia> {
  try {
    const media = await resolveInternal(text, part);
    return media.public;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError("解析失败。链接可能已失效，或平台暂时拒绝了访问。");
  }
}

export async function loadFormat(
  source: string,
  formatId: string,
): Promise<{ title: string; format: InternalFormat }> {
  if (!/^[\w.-]{1,48}$/.test(formatId)) throw new UserError("没有这个文件");
  const url = assertPublicHttp(source);
  if (!platformOf(url.hostname)) throw new UserError("不支持的链接");
  const hit = cache.get(source);
  const fresh = hit && Date.now() - hit.at < TTL_MS ? hit.media : null;
  const media = fresh ?? (await resolveInternal(source, null));
  const format = media.formats.find((item) => item.id === formatId);
  if (!format) throw new UserError("没有这个清晰度，请重新解析");
  return { title: media.public.title, format };
}
