import { useEffect, useState } from "react";
import { CircleAlert, Download, History, LoaderCircle, RotateCcw } from "lucide-react";
import { resolveMedia } from "@/lib/media/resolve";
import type { MediaFormat, Platform, ResolvedMedia } from "@/lib/media/types";

const HISTORY_KEY = "pianxia-history";

const PLATFORM_LABEL: Record<Platform, string> = {
  bilibili: "哔哩哔哩",
  douyin: "抖音",
  x: "X",
};

const EXAMPLES: { platform: Platform; label: string; url: string }[] = [
  {
    platform: "bilibili",
    label: "B 站示例",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
  },
  {
    platform: "douyin",
    label: "抖音示例",
    url: "https://www.douyin.com/video/7656698166981220322",
  },
  {
    platform: "x",
    label: "X 示例",
    url: "https://x.com/SpaceX/status/1959507875384160629",
  },
];

type HistoryItem = {
  source: string;
  title: string;
  author: string;
  platform: Platform;
  at: number;
};

function fileUrl(source: string, formatId: string, inline: boolean): string {
  const params = new URLSearchParams({ source, format: formatId });
  if (inline) params.set("inline", "1");
  return `/api/file?${params.toString()}`;
}

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes < 1) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "解析失败，请稍后再试";
}

function readHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushHistory(item: HistoryItem) {
  const next = [item, ...readHistory().filter((entry) => entry.source !== item.source)].slice(0, 8);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function Downloader() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<ResolvedMedia | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  async function parse(input: string, part: number | null) {
    const value = input.trim();
    if (!value) {
      setError("先粘贴一条视频链接");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await resolveMedia({ data: { text: value, part } });
      setMedia(result);
      setText(value);
      setHistory(
        pushHistory({
          source: result.source,
          title: result.title,
          author: result.author,
          platform: result.platform,
          at: Date.now(),
        }),
      );
    } catch (caught) {
      if (part == null) setMedia(null);
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  const videos = media?.formats.filter((item) => item.kind === "video") ?? [];
  const images = media?.formats.filter((item) => item.kind === "image" && item.id !== "cover") ?? [];
  const extras = media?.formats.filter((item) => item.kind !== "video" && !(item.kind === "image" && item.id !== "cover")) ?? [];
  const cover = media?.formats.find((item) => item.id === "cover");
  const lead = videos[0];
  const duration = formatDuration(media?.durationSec ?? null);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-14">
        <header className="mb-8">
          <p className="font-display text-sm tracking-widest text-accent">PIANXIA</p>
          <h1 className="mt-2 font-display text-5xl leading-tight text-balance text-ink">片匣</h1>
          <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-muted">
            粘贴 B 站、抖音或 X 的公开链接，选出清晰度后保存到设备。会员、私密和已删除的内容解析不了。
          </p>
        </header>

        <form
          className="rounded-3xl bg-surface p-4 ring-1 ring-line sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void parse(text, null);
          }}
        >
          <label htmlFor="video-url" className="mb-2 block text-sm font-medium">
            视频链接
          </label>
          <textarea
            id="video-url"
            name="url"
            rows={4}
            value={text}
            placeholder="粘贴链接，或整段分享文案。支持 b23.tv、v.douyin.com 和 x.com/status。"
            className="w-full resize-y rounded-2xl bg-bg px-4 py-3 text-base leading-relaxed text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-2 focus:ring-accent"
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-base font-medium text-accent-ink disabled:opacity-60"
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {pending ? "正在解析" : "解析链接"}
            </button>
            <p className="text-sm text-muted">分享口令里夹着的网址也可以</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example.platform}
                type="button"
                className="inline-flex h-11 items-center rounded-full bg-chip px-4 text-sm font-medium text-ink ring-1 ring-line"
                onClick={() => {
                  setText(example.url);
                  void parse(example.url, null);
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
        </form>

        {error ? (
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-surface px-4 py-3 text-sm leading-relaxed text-ink ring-1 ring-line" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>{error}</span>
          </p>
        ) : null}

        {media ? (
          <section className="mt-6 overflow-hidden rounded-3xl bg-surface ring-1 ring-line" aria-live="polite">
            <div className="bg-stage text-stage-fg">
              {lead ? (
                <video
                  key={lead.id + media.source}
                  className="aspect-video w-full bg-stage"
                  controls
                  playsInline
                  preload="none"
                  poster={cover ? fileUrl(media.source, cover.id, true) : undefined}
                  src={fileUrl(media.source, lead.id, true)}
                />
              ) : images.length ? (
                <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
                  {images.map((image) => (
                    <a key={image.id} href={fileUrl(media.source, image.id, false)} className="bg-stage">
                      <img
                        src={fileUrl(media.source, image.id, true)}
                        alt={image.label}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : cover ? (
                <img
                  src={fileUrl(media.source, cover.id, true)}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
              ) : null}
            </div>

            <div className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="rounded-full bg-chip px-3 py-1 font-medium text-ink">
                  {PLATFORM_LABEL[media.platform]}
                </span>
                {media.author ? <span>{media.author}</span> : null}
                {duration ? <span className="tabular-nums">{duration}</span> : null}
              </div>
              <h2 className="mt-3 text-xl leading-snug font-medium text-balance">{media.title}</h2>
              {media.note ? <p className="mt-2 text-sm leading-relaxed text-muted">{media.note}</p> : null}

              {media.parts.length > 1 ? (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {media.parts.map((part) => {
                    const active = part.index === media.partIndex;
                    return (
                      <button
                        key={part.index}
                        type="button"
                        disabled={pending}
                        className={
                          active
                            ? "h-11 shrink-0 rounded-full bg-ink px-4 text-sm font-medium text-stage-fg"
                            : "h-11 shrink-0 rounded-full bg-chip px-4 text-sm text-ink ring-1 ring-line"
                        }
                        onClick={() => void parse(media.source, part.index)}
                      >
                        {part.title}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-5 grid gap-2">
                {videos.map((item, index) => (
                  <FormatLink key={item.id} source={media.source} format={item} primary={index === 0} />
                ))}
                {images.map((item) => (
                  <FormatLink key={item.id} source={media.source} format={item} primary={false} />
                ))}
                {extras.map((item) => (
                  <FormatLink key={item.id} source={media.source} format={item} primary={false} />
                ))}
              </div>
            </div>
          </section>
        ) : (
          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["复制", "打开公开作品，复制浏览器地址，或用分享里的复制链接。"],
              ["解析", "贴进上面的框。抖音口令、b23 短链和 X 帖子链接都可以。"],
              ["保存", "选清晰度下载。手机浏览器会把文件存到下载目录。"],
            ].map(([title, body], index) => (
              <li key={title} className="rounded-2xl bg-chip p-4 ring-1 ring-line">
                <p className="text-sm font-medium">
                  {index + 1}. {title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        )}

        {history.length ? (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <History className="size-4" />
                最近解析
              </h2>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1 text-sm text-muted"
                onClick={() => {
                  localStorage.removeItem(HISTORY_KEY);
                  setHistory([]);
                }}
              >
                <RotateCcw className="size-4" />
                清空
              </button>
            </div>
            <ul className="grid gap-2">
              {history.map((item) => (
                <li key={item.source}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line"
                    onClick={() => {
                      setText(item.source);
                      void parse(item.source, null);
                    }}
                  >
                    <span className="w-16 shrink-0 text-sm text-muted">{PLATFORM_LABEL[item.platform]}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      {item.author ? <span className="block truncate text-sm text-muted">{item.author}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 text-sm leading-relaxed text-muted">
          只处理你提交的单条公开链接，用来保存你有权留存的内容。请尊重作者权利，不要用来搬运或传播受限作品。
        </p>
      </div>
    </main>
  );
}

function FormatLink({
  source,
  format,
  primary,
}: {
  source: string;
  format: MediaFormat;
  primary: boolean;
}) {
  const size = formatBytes(format.bytes);
  const detail = [format.label, size].filter(Boolean).join(" · ");
  return (
    <a
      href={fileUrl(source, format.id, false)}
      className={
        primary
          ? "inline-flex h-12 w-full items-center justify-between gap-3 rounded-full bg-accent px-5 text-base font-medium text-accent-ink"
          : "inline-flex h-12 w-full items-center justify-between gap-3 rounded-full bg-chip px-5 text-sm font-medium text-ink ring-1 ring-line"
      }
    >
      <span className="inline-flex items-center gap-2">
        <Download className="size-4" />
        {primary ? "下载" : "保存"}
        {detail}
      </span>
      <span className="uppercase">{format.ext}</span>
    </a>
  );
}
