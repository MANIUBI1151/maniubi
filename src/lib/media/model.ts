import type { MediaFormat, ResolvedMedia } from "./types";

export type InternalFormat = MediaFormat & {
  url: string;
  referer: string;
};

export type InternalMedia = {
  public: ResolvedMedia;
  formats: InternalFormat[];
};
