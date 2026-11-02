import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageCircle, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import assistantLogo from "@/assets/maxi-asistente.png";

const STORAGE_KEY = "invenco.asistente.chat.v1";

const SUGGESTIONS = [
  "¿Qué debo reponer hoy?",
  "¿Qué conviene liquidar antes de que venza?",
  "¿Cómo van las ventas de la semana?",
  "¿Qué producto no se está vendiendo?",
];

function loadMessages(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as UIMessage[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const textOf = (m: UIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [initial] = useState<UIMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const transport = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      headers: async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ).current;

  const { messages, sendMessage, setMessages, status } = useChat({
    id: "invenco-asistente",
    messages: initial,
    transport,
    onError: (error) => {
      const raw = String(error.message || "");
      const friendly = /agotado|cuota|quota|rate limit|429|temporalm/i.test(raw)
        ? "Maxi está temporalmente sin disponibilidad por cuota de Gemini. Inténtalo en unos segundos."
        : raw || "El asistente no pudo responder.";
      toast.error(friendly);
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (typeof window === "undefined" || status === "streaming") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* almacenamiento lleno o no disponible */
    }
  }, [messages, status]);

  useEffect(() => {
    if (open && !busy) textareaRef.current?.focus();
  }, [open, busy, messages.length]);

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || busy) return;
      setInput("");
      void sendMessage({ text: value });
    },
    [busy, sendMessage],
  );

  const reset = () => {
    setMessages([]);
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    textareaRef.current?.focus();
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir asistente Maxi"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary py-2.5 pl-2.5 pr-4 text-primary-foreground shadow-lg transition-transform hover:scale-[1.03]"
        >
          <img src={assistantLogo} alt="" className="size-8 rounded-full bg-background/20 object-cover" />
          <span className="text-sm font-semibold">Asistente</span>
        </button>
      )}

      <div
        className={cn(
          "fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-[26rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl transition-all sm:bottom-5 sm:right-5",
          open ? "h-[min(34rem,calc(100vh-2rem))] opacity-100" : "pointer-events-none h-0 opacity-0",
        )}
      >
        <div className="flex items-center gap-3 border-b bg-primary/5 px-4 py-3">
          <img src={assistantLogo} alt="Maxi, asistente de Invenco" className="size-9 rounded-full object-cover" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">Maxi · Asistente</p>
            <p className="truncate text-xs text-muted-foreground">Conoce tu inventario y tus ventas</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={reset} title="Borrar conversación">
              <RotateCcw className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} title="Cerrar">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-3 p-3">
            {messages.length === 0 ? (
              <div className="space-y-3 py-4 text-center">
                <img src={assistantLogo} alt="" className="mx-auto size-14 rounded-2xl object-cover" />
                <div>
                  <p className="text-sm font-semibold">Hola, soy Maxi 👋</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pregúntame qué reponer, qué liquidar o cómo van tus ventas.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-lg border bg-background px-3 py-2 text-left text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <Message key={m.id} from={m.role}>
                  <MessageContent
                    className={cn(
                      "text-sm",
                      m.role === "assistant" && "bg-transparent px-0 text-foreground",
                    )}
                  >
                    <MessageResponse>{textOf(m)}</MessageResponse>
                  </MessageContent>
                </Message>
              ))
            )}
            {status === "submitted" && <Shimmer className="px-1 text-sm">Pensando...</Shimmer>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput
            onSubmit={(_message, event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escríbele a Maxi…"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!input.trim() && !busy} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
}
