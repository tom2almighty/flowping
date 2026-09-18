import { type ComponentProps, type DragEvent, useState } from "react";

/** Row props plus the data attributes the stylesheet keys off. */
type DragRowProps = ComponentProps<"tr"> & Record<`data-${string}`, string | undefined>;

/**
 * Row drag-and-drop for the admin tables. It hands back the props each row
 * needs plus helpers, so the caller only supplies the id list and what to do
 * with the new order. Arrow-key equivalents are exposed through `move`, since
 * HTML5 drag events never fire from a touch screen or a keyboard.
 */
export function useDragOrder(ids: string[], onReorder: (ids: string[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const clear = () => {
    setDragId(null);
    setOverId(null);
  };

  const rowProps = (id: string): DragRowProps => ({
    draggable: true,
    "data-drag": dragId === id ? "true" : undefined,
    "data-over": overId === id ? "true" : undefined,
    onDragStart: (e: DragEvent<HTMLTableRowElement>) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent<HTMLTableRowElement>) => {
      e.preventDefault();
      if (dragId && dragId !== id) setOverId(id);
    },
    onDrop: (e: DragEvent<HTMLTableRowElement>) => {
      e.preventDefault();
      if (!dragId || dragId === id) {
        clear();
        return;
      }
      const next = moveID(ids, dragId, id);
      clear();
      if (next !== ids) onReorder(next);
    },
    onDragEnd: clear,
  });

  /** Shift an item one slot; the keyboard and touch equivalent of a drag. */
  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };

  const edge = (id: string) => ({
    first: ids[0] === id,
    last: ids[ids.length - 1] === id,
  });

  return { rowProps, move, edge, dragging: dragId !== null };
}

/** Moves `from` into `to`'s slot, leaving everything else in order. */
export function moveID(ids: string[], from: string, to: string): string[] {
  const fi = ids.indexOf(from);
  const ti = ids.indexOf(to);
  if (fi < 0 || ti < 0 || fi === ti) return ids;
  const next = [...ids];
  next.splice(ti, 0, ...next.splice(fi, 1));
  return next;
}
