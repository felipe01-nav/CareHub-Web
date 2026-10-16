// CareHub: "Freeze columns" for table (grid) views.
// The number of frozen columns is saved on the database view itself, so it is
// the same for everyone and survives a reload. Frozen columns stay on the left
// while you scroll sideways.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { isAIFieldType, useDatabaseView } from '@/application/database-yjs';
import { useFieldsSelector } from '@/application/database-yjs/selector';
import { useAIEnabled } from '@/components/app/app.hooks';

export const CAREHUB_FREEZE_KEY = 'carehub_frozen_columns';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMap = any;

function readCount(view: AnyMap): number {
  const value = Number(view?.get?.(CAREHUB_FREEZE_KEY));

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** [frozen column count, set count (0 = unfreeze)] for the current view. */
export function useCarehubFrozenCount(): [number, (count: number) => void] {
  const view = useDatabaseView() as AnyMap;
  const [count, setCount] = useState<number>(() => readCount(view));

  useEffect(() => {
    setCount(readCount(view));
    if (!view?.observe) return;
    const onChange = () => setCount(readCount(view));

    view.observe(onChange);
    return () => {
      view.unobserve(onChange);
    };
  }, [view]);

  const update = useCallback(
    (next: number) => {
      if (!view?.set) return;
      const apply = () => {
        if (next > 0) view.set(CAREHUB_FREEZE_KEY, Math.floor(next));
        else if (view.has?.(CAREHUB_FREEZE_KEY)) view.delete(CAREHUB_FREEZE_KEY);
      };

      if (view.doc?.transact) view.doc.transact(apply);
      else apply();
      setCount(next > 0 ? Math.floor(next) : 0);
    },
    [view]
  );

  return [count, update];
}

/** Position (0-based) of a field among the visible columns, or -1. */
export function useCarehubFieldIndex(fieldId: string): number {
  const fields = useFieldsSelector() as Array<{ fieldId?: string; fieldType?: number }>;
  const aiEnabled = useAIEnabled();

  return useMemo(() => {
    const visible = fields.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (column) => aiEnabled || !isAIFieldType(column.fieldType as any)
    );

    return visible.findIndex((column) => column.fieldId === fieldId);
  }, [aiEnabled, fieldId, fields]);
}

/** Never freeze more than the real columns (not the "+" column). */
export function clampFrozenCount(count: number, columns: Array<{ fieldId?: string }>): number {
  if (count <= 0) return 0;
  const fieldColumns = columns.filter((column) => Boolean(column.fieldId)).length;

  return Math.max(0, Math.min(count, fieldColumns));
}

export interface CarehubFreezeInfo {
  /** How many columns (from the left) are frozen. */
  count: number;
  /** Where the first column starts (the table's left padding). */
  origin: number;
}

export const CarehubFreezeContext = createContext<CarehubFreezeInfo>({ count: 0, origin: 0 });

export function useCarehubFreeze() {
  return useContext(CarehubFreezeContext);
}

export function CareHubFreezeIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'
      strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3.5' y='4' width='17' height='16' rx='2' />
      <path d='M9.5 4v16' />
      <path d='M5.5 8h2M5.5 12h2M5.5 16h2' />
    </svg>
  );
}
