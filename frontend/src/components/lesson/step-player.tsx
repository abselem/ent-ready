"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AsyncState } from "@/components/ui/async-state";
import { LessonBlockView } from "./block-view";
import { lessonStepExcerpt, lessonStepLabel, orderedLessonBlocks, type LessonBlock } from "./types";

export function LessonStepPlayer({ blocks }: { blocks: readonly LessonBlock[] }) {
  return <Suspense fallback={<AsyncState kind="loading" title="Открываем шаг урока" />}><StepPlayer blocks={blocks} /></Suspense>;
}

function StepPlayer({ blocks }: { blocks: readonly LessonBlock[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const ordered = orderedLessonBlocks(blocks);
  const requestedId = Number(params.get("step"));
  const found = ordered.findIndex(block => block.id === requestedId);
  const index = found >= 0 ? found : 0;
  const block = ordered[index];
  const heading = useRef<HTMLHeadingElement>(null);
  const previousId = useRef(block?.id);

  useEffect(() => {
    if (block?.id && previousId.current !== block.id) heading.current?.focus();
    previousId.current = block?.id;
  }, [block?.id]);

  function select(id: number) {
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set("step", String(id));
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  if (!block) return <AsyncState kind="empty" title="Шаги ещё не добавлены" description="Материалы появятся после того, как преподаватель заполнит урок." />;

  return <section aria-label="Шаги урока" className="min-w-0 space-y-5">
    <nav aria-label="Выбор шага урока" className="surface p-3">
      <ol className="flex flex-wrap gap-2">
        {ordered.map((step, i) => <li key={step.id}>
          <button type="button" onClick={() => select(step.id)} aria-current={step.id === block.id ? "step" : undefined}
            aria-label={`Шаг ${i + 1}: ${lessonStepLabel(step.type)}. ${lessonStepExcerpt(step)}`}
            title={lessonStepExcerpt(step)}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium ${step.id === block.id ? "border-primary bg-primary text-primary-foreground" : "border-control-border bg-card text-foreground hover:bg-muted"}`}>
            {i + 1}
          </button>
        </li>)}
      </ol>
    </nav>

    <article className="surface min-w-0 p-5 md:p-8">
      <p className="mb-2 text-sm text-muted-foreground">Шаг {index + 1} из {ordered.length}</p>
      <h2 ref={heading} tabIndex={-1} className="mb-6 text-xl font-semibold outline-none focus-visible:rounded focus-visible:outline-2 focus-visible:outline-primary">{lessonStepLabel(block.type)}</h2>
      <LessonBlockView block={block} />
    </article>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" disabled={index === 0} onClick={() => select(ordered[index - 1].id)}>← Назад</Button>
      {index < ordered.length - 1
        ? <Button onClick={() => select(ordered[index + 1].id)}>Далее →</Button>
        : <p className="text-sm text-muted-foreground">Это последний шаг урока</p>}
    </div>
  </section>;
}
