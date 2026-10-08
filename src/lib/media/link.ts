import type { Platform } from "./types";

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  bilibili: ["bilibili.com", "b23.tv", "b23.wtf", "bili2233.cn", "acg.tv"],
  douyin: ["douyin.com", "iesdouyin.com"],
  x: ["x.com", "twitter.com", "t.co", "fxtwitter.com", "vxtwitter.com", "fixupx.com"],
};

export function extractHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'「」【】]+/i);
  if (!match) return null;
  return match[0].replace(/[)）,。；;]+$/u, "");
}

export function hostIs(hostname: string, suffixes: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function platformOf(hostname: string): Platform | null {
  const host = hostname.toLowerCase();
  const platforms = Object.keys(PLATFORM_HOSTS) as Platform[];
  for (const platform of platforms) {
    if (hostIs(host, PLATFORM_HOSTS[platform])) return platform;
  }
  return null;
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (host.includes(":")) return true;
  return false;
}
