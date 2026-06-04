/**
 * useLocalHistory — سجل الملفات المحلي بدون server
 * يُخزّن metadata الملفات في localStorage
 */

import { useState, useCallback, useEffect } from "react";

export interface HistoryEntry {
  id:         string;
  name:       string;
  sizeMb:     number;
  duration:   number;   // ثوانٍ
  date:       string;   // ISO
  operations: string[]; // ["إزالة الصمت", "ضغط الصوت", ...]
  exportFmt?: string;   // "mp3" | "wav"
}

const KEY = "sap_history_v1";
const MAX  = 50;

function load(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch { /* quota exceeded */ }
}

export function useLocalHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>(load);

  // إضافة إدخال جديد
  const addEntry = useCallback((entry: Omit<HistoryEntry, "id" | "date">) => {
    setEntries(prev => {
      const next = [
        { ...entry, id: crypto.randomUUID(), date: new Date().toISOString() },
        ...prev,
      ].slice(0, MAX);
      save(next);
      return next;
    });
  }, []);

  // حذف إدخال
  const removeEntry = useCallback((id: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      save(next);
      return next;
    });
  }, []);

  // مسح الكل
  const clearAll = useCallback(() => {
    localStorage.removeItem(KEY);
    setEntries([]);
  }, []);

  // إضافة عملية لإدخال موجود
  const addOperation = useCallback((id: string, op: string) => {
    setEntries(prev => {
      const next = prev.map(e =>
        e.id === id
          ? { ...e, operations: [...new Set([...e.operations, op])] }
          : e
      );
      save(next);
      return next;
    });
  }, []);

  return { entries, addEntry, removeEntry, clearAll, addOperation };
}
