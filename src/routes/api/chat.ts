import { createFileRoute } from "@tanstack/react-router";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { buildBusinessSnapshot, userClient } from "@/lib/assistant-context.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token || token.split(".").length !== 3) {
          return new Response("No autorizado", { status: 401 });
        }

        const key = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
        if (!key) return new Response("Falta GOOGLE_GENERATIVE_AI_API_KEY", { status: 500 });

        let messages: UIMessage[];
        try {
          const body = (await request.json()) as { messages?: unknown };
          if (!Array.isArray(body.messages)) return new Response("Mensajes requeridos", { status: 400 });
          messages = body.messages as UIMessage[];
        } catch {
          return new Response("Cuerpo inválido", { status: 400 });
        }

        let snapshot = "";
        let isAdmin = false;
        try {
          const supabase = userClient(token);
          const { data: userRes, error: userErr } = await supabase.auth.getUser();
          if (userErr || !userRes.user) return new Response("No autorizado", { status: 401 });
          const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
          isAdmin = (roles ?? []).some((r) => r.role === "admin");
          snapshot = await buildBusinessSnapshot(supabase, isAdmin);
        } catch (e) {
          return new Response(e instanceof Error ? e.message : "Error de datos", { status: 500 });
        }

        const system = [
          "Eres «Maxi», el asistente de Invenco, el sistema de punto de venta e inventario del minimarket.",
          "Hablas siempre en español de Chile, cercano y directo, como un asesor de almacén con experiencia.",
          "Usas los datos reales del local que se entregan abajo. Nunca inventes cifras: si un dato no está, dilo.",
          "Montos en pesos chilenos sin decimales (ej: $1.990). Cantidades en kilos con 2 decimales o unidades.",
          "Sé breve: respuestas de 2 a 6 líneas, con viñetas cuando listes productos o acciones.",
          "Da recomendaciones concretas y accionables: qué reponer, qué liquidar con descuento flash antes de que venza,",
          "qué producto conviene destacar, dónde hay riesgo de merma y qué no se está vendiendo.",
          isAdmin
            ? "El usuario es administrador: puedes hablar de costos, márgenes y utilidad."
            : "El usuario es cajero: enfócate en ventas, stock y vencimientos; evita detalles de costos y márgenes.",
          "",
          "=== DATOS ACTUALES DEL LOCAL ===",
          snapshot,
        ].join("\n");

        const google = createGoogleGenerativeAI({ apiKey: key });
        const env = process.env as Record<string, string | undefined>;
        const modelName = env["GEMINI_MODEL"] ?? "gemini-3.8-flash";

        try {
          const result = streamText({
            model: google(modelName),
            system,
            messages: await convertToModelMessages(messages),
          });
          return result.toUIMessageStreamResponse({ originalMessages: messages });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Error de IA";
          const status = /429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(message) ? 429 : 500;
          const friendly = /429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(message)
            ? "El asistente de Gemini está temporalmente agotado por cuota. Intenta de nuevo en unos segundos."
            : message;
          return new Response(friendly, { status });
        }
      },
    },
  },
});
