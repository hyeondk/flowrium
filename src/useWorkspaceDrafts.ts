import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { ComposerDraft } from "../shared/security";

type Drafts = Record<string, ComposerDraft>;
type Patch = Record<string, ComposerDraft | null>;
function merge(values: Drafts, patch: Patch) {
  const next = { ...values };
  for (const [key, draft] of Object.entries(patch)) {
    if (draft) next[key] = draft;
    else delete next[key];
  }
  return next;
}
function errorText(e: unknown) {
  return e instanceof Error
    ? e.message.replace(/^.*?Error: /, "")
    : "초안을 보관하지 못했습니다.";
}
export function useWorkspaceDrafts(revision: number) {
  const [drafts, setState] = useState<Drafts>({});
  const [error, setError] = useState("");
  const current = useRef<Drafts>({});
  const dirty = useRef<Patch>({});
  const alive = useRef(true);
  const api = window.flowrium;
  const restore = useCallback(async () => {
    if (!api) return;
    const saved = await api.readDrafts(revision);
    if (!alive.current) return;
    const next = merge(saved, dirty.current);
    current.current = next;
    setState(next);
    setError("");
    const patch = { ...dirty.current };
    if (Object.keys(patch).length) await api.writeDrafts(revision, patch);
  }, [api, revision]);
  useEffect(() => {
    alive.current = true;
    restore().catch((e) => {
      if (alive.current) setError(errorText(e));
    });
    return () => {
      alive.current = false;
    };
  }, [restore]);
  const setDrafts = useCallback(
    (action: SetStateAction<Drafts>) => {
      const before = current.current;
      const next = typeof action === "function" ? action(before) : action;
      const patch: Patch = {};
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(next),
      ])) {
        if (
          before[key]?.text !== next[key]?.text ||
          before[key]?.mode !== next[key]?.mode ||
          JSON.stringify(before[key]?.attachments||[]) !== JSON.stringify(next[key]?.attachments||[])
        )
          patch[key] = next[key] || null;
      }
      if (!Object.keys(patch).length) return;
      current.current = next;
      setState(next);
      Object.assign(dirty.current, patch);
      if (api)
        void api
          .writeDrafts(revision, patch)
          .then(() => {
            if (!alive.current) return;
            setError("");
          })
          .catch((e) => {
            if (alive.current) setError(errorText(e));
          });
    },
    [api, revision],
  );
  const retry = () => {
    void restore().catch((e) => setError(errorText(e)));
  };
  return { drafts, setDrafts, error, retry };
}
