// Answers being written, shared by every chat view (the Chat section and the
// panel beside a database) and kept while the user moves around the app.
import { useSyncExternalStore } from "react";

export type Run = { messageId: string | null; content: string; question: string; regenerate: boolean };
let runs = new Map<string, Run>();
const listeners = new Set<() => void>();
let subscribed = false;

const publish = (next: Map<string, Run>) => {
  runs = next;
  for (const listener of listeners) listener();
};
function listen() {
  if (subscribed || !window.imago?.onChatDelta) return;
  subscribed = true;
  window.imago.onChatDelta((delta) => {
    const run = runs.get(delta.conversationId);
    if (!run) return;
    publish(new Map(runs).set(delta.conversationId, { ...run, messageId: delta.messageId, content: delta.content }));
  });
}

export function startRun(conversationId: string, question: string, regenerate: boolean) {
  listen();
  publish(new Map(runs).set(conversationId, { messageId: null, content: "", question, regenerate }));
}
export function endRun(conversationId: string) {
  const next = new Map(runs);
  next.delete(conversationId);
  publish(next);
}
export function useChatRuns(): ReadonlyMap<string, Run> {
  return useSyncExternalStore(
    (listener) => {
      listen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => runs,
  );
}
