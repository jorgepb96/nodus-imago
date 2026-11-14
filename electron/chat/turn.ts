// One turn of the database chat, run in the main process because it holds
// the provider keys: it builds the context in the worker, streams the answer
// to the window, runs each ```calc block in the isolated process and saves
// the conversation, also when the user has moved to another chat.
import { randomUUID as uuid } from "node:crypto";
import type { ApiProviders } from "../ai/apiProviders";
import {
  CALC_ROUNDS,
  buildChatContext,
  buildChatUser,
  calcFeedback,
  calcResultBlock,
  chatSystem,
  chatTitle,
  extractCalc,
  type ChatConversation,
  type ChatDataPart,
  type ChatDelta,
  type ChatMessage,
  type ChatTurnRequest,
  type ChatTurnResult,
} from "../../shared/chat";
import { runCalc } from "./sandbox";

type Call = (command: string, input?: unknown) => Promise<any>;

export class ChatRunner {
  private running = new Map<string, AbortController>();
  constructor(
    private call: Call,
    private providers: ApiProviders,
    private sandbox: string,
    private send: (delta: ChatDelta) => void,
  ) {}

  isRunning(conversationId: string) {
    return this.running.has(conversationId);
  }
  cancel(conversationId: string) {
    this.running.get(conversationId)?.abort();
  }
  cancelAll() {
    for (const abort of this.running.values()) abort.abort();
  }

  async run(request: ChatTurnRequest): Promise<ChatTurnResult> {
    if (this.running.has(request.conversationId))
      throw new Error("Esta conversación ya está respondiendo.");
    const abort = new AbortController();
    this.running.set(request.conversationId, abort);
    try {
      return await this.turn(request, abort.signal);
    } finally {
      this.running.delete(request.conversationId);
    }
  }

  private async turn(request: ChatTurnRequest, signal: AbortSignal): Promise<ChatTurnResult> {
    const settings = await this.call("_settings");
    const language: "es" | "en" = settings.language === "en" ? "en" : "es";
    const conversation: ChatConversation = await this.call("chatGet", { id: request.conversationId });
    const messages = [...conversation.messages];
    let question = request.question.trim();
    if (request.regenerate) {
      while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
      question = messages[messages.length - 1]?.content ?? "";
      if (!question) throw new Error("No hay ninguna pregunta que repetir.");
    } else {
      if (!question) throw new Error("Escribe una pregunta.");
      messages.push({ id: uuid(), role: "user", content: question, createdAt: new Date().toISOString() });
    }
    const first = messages.filter((m) => m.role === "user").length === 1;
    const title = first && (conversation.title === "Chat" || !conversation.messageCount) ? chatTitle(question) : undefined;
    await this.call("chatUpdate", {
      ids: [conversation.id],
      databaseIds: request.databaseIds,
      model: request.model,
      mode: request.mode,
    });
    await this.call("_chatSaveMessages", { id: conversation.id, messages, title });

    const answer: ChatMessage = {
      id: uuid(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model: `${request.model.provider}/${request.model.model}`,
    };
    let content = "",
      live = "",
      last = 0,
      pending: ReturnType<typeof setTimeout> | undefined;
    // At most about 20 repaints a second, and never drop the last one.
    const emit = (now = false) => {
      const flush = () => {
        pending = undefined;
        last = Date.now();
        this.send({ conversationId: conversation.id, messageId: answer.id, content: content + live });
      };
      clearTimeout(pending);
      if (now || Date.now() - last > 50) flush();
      else pending = setTimeout(flush, 50 - (Date.now() - last));
    };
    try {
      const parts: ChatDataPart[] = await this.call("_chatContext", {
        databaseIds: request.databaseIds,
        mode: request.mode,
        language,
      });
      const history = messages.slice(0, -1);
      const api: { role: "user" | "assistant"; content: string }[] = [
        {
          role: "user",
          content: buildChatUser(buildChatContext(parts, language), question, history, language),
        },
      ];
      const limit = CALC_ROUNDS[request.mode];
      let calcs = 0,
        dataset: string | null = null;
      emit(true);
      for (;;) {
        live = "";
        const text = await this.providers.chatStream(
          {
            choice: request.model,
            profiles: settings.apiProfiles,
            remoteEnabled: settings.remoteEnabled,
            system: chatSystem(language),
            messages: api,
            maxTokens: request.mode === "extended" ? 8192 : 4096,
          },
          (piece) => {
            live += piece;
            emit();
          },
          signal,
        );
        live = "";
        const calc = calcs < limit ? extractCalc(text) : null;
        if (!calc) {
          content += text;
          break;
        }
        const asked = text.slice(0, calc.end);
        content += asked;
        emit(true);
        dataset ??= JSON.stringify(await this.call("_chatDataset", { databaseIds: request.databaseIds }));
        const outcome = await runCalc(this.sandbox, calc.code, dataset, signal, {
          timeoutMs: request.mode === "extended" ? 15_000 : 8000,
        });
        if (signal.aborted) throw new Error("Solicitud cancelada.");
        calcs++;
        content += calcResultBlock(outcome);
        emit(true);
        api.push(
          { role: "assistant", content: asked },
          { role: "user", content: calcFeedback(outcome, language, calcs >= limit) },
        );
      }
      answer.content = content.trim();
      if (!answer.content) throw new Error("El modelo no ha devuelto texto.");
    } catch (error) {
      clearTimeout(pending);
      if (signal.aborted) {
        answer.content = (content + live).trim();
        answer.interrupted = true;
      } else {
        answer.content = error instanceof Error ? error.message : String(error);
        answer.error = true;
      }
    }
    clearTimeout(pending);
    messages.push(answer);
    await this.call("_chatSaveMessages", { id: conversation.id, messages });
    return { message: answer, title: title ?? conversation.title };
  }
}
