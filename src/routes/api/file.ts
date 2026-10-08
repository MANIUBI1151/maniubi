import { createFileRoute } from "@tanstack/react-router";
import { UserError, assertMediaUrl, contentDisposition, fileName, UA_DESKTOP } from "@/lib/media/http.server";
import { loadFormat } from "@/lib/media/resolve.server";

async function fetchMedia(url: string, referer: string, range: string | null): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    assertMediaUrl(current);
    const headers: Record<string, string> = {
      "User-Agent": UA_DESKTOP,
      Referer: referer,
      Accept: "*/*",
    };
    if (range) headers.Range = range;
    const response = await fetch(current, { headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.arrayBuffer().catch(() => undefined);
      if (!location) throw new UserError("源站没有返回文件");
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  throw new UserError("下载地址跳转过多");
}

export const Route = createFileRoute("/api/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams;
        const source = query.get("source") ?? "";
        const format = query.get("format") ?? "";
        const inline = query.get("inline") === "1";
        try {
          if (source.length > 2000) throw new UserError("链接太长");
          const loaded = await loadFormat(source, format);
          const upstream = await fetchMedia(
            loaded.format.url,
            loaded.format.referer,
            request.headers.get("range"),
          );
          const type = upstream.headers.get("content-type") ?? "";
          if (!upstream.ok && upstream.status !== 206) {
            await upstream.arrayBuffer().catch(() => undefined);
            return Response.json({ error: "源站拒绝了这个文件，请重新解析后再试" }, { status: 502 });
          }
          if (type.includes("text/html") || type.includes("application/json")) {
            await upstream.arrayBuffer().catch(() => undefined);
            return Response.json({ error: "源站没有返回媒体文件，请重新解析" }, { status: 502 });
          }
          const headers = new Headers();
          headers.set(
            "Content-Type",
            type || (loaded.format.kind === "video" ? "video/mp4" : "application/octet-stream"),
          );
          headers.set(
            "Content-Disposition",
            contentDisposition(fileName(loaded.title, loaded.format.ext), inline),
          );
          headers.set("Cache-Control", "private, max-age=300");
          const length = upstream.headers.get("content-length");
          const rangeHeader = upstream.headers.get("content-range");
          const accept = upstream.headers.get("accept-ranges");
          if (length) headers.set("Content-Length", length);
          if (rangeHeader) headers.set("Content-Range", rangeHeader);
          headers.set("Accept-Ranges", accept || "bytes");
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch (error) {
          const message = error instanceof UserError ? error.message : "下载失败，请重新解析后再试";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
