"use client";

import { useEffect, useState } from "react";
import { api, apiOrigin } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

function QaAssetImage({ subject, alt, className }: { subject: string; alt: string; className?: string }) {
  const { user, sessionVersion, accessToken } = useAuthStore();
  const key = `${user?.id ?? "none"}:${sessionVersion}:${subject}`;
  const [image, setImage] = useState<{ key: string; url?: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!user || !accessToken) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    const userId = user.id;
    void api.get<Blob>(`/qa/assets/subject/${subject}`, { responseType: "blob", signal: controller.signal }).then(({ data }) => {
      const current = useAuthStore.getState();
      if (!active || current.user?.id !== userId || current.sessionVersion !== sessionVersion || !current.accessToken) return;
      if (data.type !== "image/png") throw new Error("Unexpected image response");
      objectUrl = URL.createObjectURL(data);
      setImage({ key, url: objectUrl });
    }).catch(() => {
      if (active) setImage({ key, error: true });
    });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [subject, user, sessionVersion, accessToken, key]);
  if (!user || !accessToken) return <p className="text-sm text-muted-foreground">Для изображения нужен вход в тестовую школу.</p>;
  if (image?.key !== key) return <p role="status" className="text-sm text-muted-foreground">Загружаем изображение…</p>;
  if (image.error || !image.url) return <p role="alert" className="text-sm text-muted-foreground">Не удалось загрузить изображение. Проверьте доступ к QA-школе и обновите страницу.</p>;
  // The blob URL is created locally from an authenticated PNG response only.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image.url} alt={alt} className={className} />;
}

/** Never send authentication to an arbitrary content URL. */
export function LessonImage({ content, alt, className }: { content: string; alt: string; className?: string }) {
  const asset = /^qa-asset:\/\/subject\/(1[0-4]|[1-9])$/.exec(content);
  if (asset) return <QaAssetImage key={content} subject={asset[1]} alt={alt} className={className} />;
  const src = content.startsWith("/static/") ? `${apiOrigin}${content}` : content;
  if (!/^https?:\/\//i.test(src)) return <p className="text-sm text-muted-foreground">Ссылка на изображение недоступна.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
