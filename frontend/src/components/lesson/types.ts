export interface LessonBlock {
  id: number;
  type: string;
  content: string;
  language: string;
  caption: string;
  order_num: number;
}

const stepLabels: Record<string, string> = {
  text: "Текст", code: "Код", image: "Изображение", note: "Заметка",
};

export function lessonStepLabel(type: string) {
  return Object.prototype.hasOwnProperty.call(stepLabels, type) ? stepLabels[type] : "Материал";
}

export function lessonStepExcerpt(block: LessonBlock) {
  const value = block.type === "image" ? block.caption : block.content;
  return value.replace(/\s+/g, " ").trim().slice(0, 70) || lessonStepLabel(block.type);
}

export function orderedLessonBlocks(blocks: readonly LessonBlock[]) {
  return [...blocks].sort((a, b) => a.order_num - b.order_num || a.id - b.id);
}
