export type Platform = "bilibili" | "douyin" | "x";

export type MediaKind = "video" | "image" | "audio";

export type MediaFormat = {
  id: string;
  label: string;
  kind: MediaKind;
  ext: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
};

export type MediaPart = {
  index: number;
  title: string;
};

/** What the browser is allowed to see. Direct CDN addresses stay on the server. */
export type ResolvedMedia = {
  platform: Platform;
  title: string;
  author: string;
  durationSec: number | null;
  source: string;
  formats: MediaFormat[];
  parts: MediaPart[];
  partIndex: number | null;
  note: string | null;
};
