import { createServerFn } from "@tanstack/react-start";
import type { ResolvedMedia } from "./types";

function readInput(input: unknown): { text: string; part: number | null } {
  if (!input || typeof input !== "object") throw new Error("请粘贴视频链接");
  const text = "text" in input && typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < 6 || text.length > 2000) throw new Error("请粘贴一条完整的视频链接");
  let part: number | null = null;
  if ("part" in input && input.part != null && input.part !== "") {
    const value = Number(input.part);
    if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error("没有这一集");
    part = value;
  }
  return { text, part };
}

export const resolveMedia = createServerFn({ method: "POST" })
  .validator(readInput)
  .handler(async ({ data }): Promise<ResolvedMedia> => {
    const { resolvePublic } = await import("./resolve.server");
    return resolvePublic(data.text, data.part);
  });
