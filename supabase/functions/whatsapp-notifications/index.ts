import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Settings = {
  owner_whatsapp: string;
  whatsapp_notifications_enabled: boolean;
  daily_report_enabled: boolean;
  daily_report_hour: number;
  inventory_alerts_enabled: boolean;
  expiry_alert_days: number;
  last_report_on: string | null;
};

type Notification = {
  id: string;
  notification_type: string;
  recipient: string;
  message: string;
  metadata: Record<string, unknown>;
  attempts: number;
};

const DAILY_REPORT_PARAMETER_COUNT = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta configurar el secreto ${name} en Supabase.`);
  return value;
}

function adminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function localDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function chileOffsetAt(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return (
    Date.UTC(
      values["year"],
      values["month"] - 1,
      values["day"],
      values["hour"],
      values["minute"],
      values["second"],
    ) - date.getTime()
  );
}

function utcRangeForChileDate(date: Date) {
  const local = localDateTimeParts(date);
  const dateString = `${local["year"]}-${local["month"]}-${local["day"]}`;
  const [year, month, day] = dateString.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDateString = nextDate.toISOString().slice(0, 10);
  const localMidnightUtc = (value: string) => {
    const [localYear, localMonth, localDay] = value.split("-").map(Number);
    const utcNoon = new Date(Date.UTC(localYear, localMonth - 1, localDay, 12));
    const offset = chileOffsetAt(utcNoon);
    return new Date(Date.UTC(localYear, localMonth - 1, localDay) - offset);
  };
  return {
    dateString,
    from: localMidnightUtc(dateString).toISOString(),
    to: localMidnightUtc(nextDateString).toISOString(),
  };
}

function clp(value: number) {
  return `$${Math.round(value).toLocaleString("es-CL")}`;
}

async function loadSettings(client: ReturnType<typeof adminClient>) {
  const { data, error } = await client.from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`No se pudo leer la configuración del local: ${error.message}`);
  return data as Settings;
}

async function createDailyReport(
  client: ReturnType<typeof adminClient>,
  settings: Settings,
  date = new Date(),
) {
  const { dateString, from, to } = utcRangeForChileDate(date);
  const [movementsResult, paymentsResult, productsResult] = await Promise.all([
    client
      .from("movements")
      .select("type, qty, unit, amount, cost_amount, product_name, ts")
      .gte("ts", from)
      .lt("ts", to),
    client.from("sale_payments").select("total").gte("created_at", from).lt("created_at", to),
    client.from("products").select("name, stock, min_stock").eq("active", true),
  ]);
  const error = movementsResult.error ?? paymentsResult.error ?? productsResult.error;
  if (error) throw new Error(`No se pudo generar el reporte diario: ${error.message}`);

  const movements = movementsResult.data ?? [];
  const sales = movements.filter((movement) => movement.type === "out");
  const waste = movements.filter((movement) => movement.type === "merma");
  const payments = paymentsResult.data ?? [];
  const totalSales = payments.reduce((sum, payment) => sum + Number(payment.total), 0);
  const profit = sales.reduce(
    (sum, movement) => sum + Number(movement.amount) - Number(movement.cost_amount),
    0,
  );
  const topProducts = new Map<string, number>();
  for (const sale of sales) {
    topProducts.set(
      sale.product_name,
      (topProducts.get(sale.product_name) ?? 0) + Number(sale.qty),
    );
  }
  const top = [...topProducts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const lowStock = (productsResult.data ?? [])
    .filter((product) => Number(product.stock) <= Number(product.min_stock))
    .slice(0, 6);
  const mermaByUnit = new Map<string, number>();
  for (const movement of waste) {
    mermaByUnit.set(movement.unit, (mermaByUnit.get(movement.unit) ?? 0) + Number(movement.qty));
  }
  const mermaSummary =
    [...mermaByUnit]
      .map(([unit, quantity]) => {
        const formattedQuantity = quantity.toLocaleString("es-CL", {
          maximumFractionDigits: 3,
        });
        return unit === "kilo" ? `${formattedQuantity} kg` : `${formattedQuantity} unidades`;
      })
      .join(", ") || "ninguna";
  const lowStockSummary =
    lowStock
      .map((product) => {
        const quantity = Number(product.stock).toLocaleString("es-CL", {
          maximumFractionDigits: 3,
        });
        const minimum = Number(product.min_stock).toLocaleString("es-CL", {
          maximumFractionDigits: 3,
        });
        return `${product.name} (${quantity}; mín. ${minimum})`;
      })
      .join(", ") || "ninguno";
  const reportDate = new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "long",
    timeZone: "America/Santiago",
  }).format(date);
  const templateParameters = [
    reportDate,
    Math.round(totalSales).toLocaleString("es-CL"),
    String(payments.length),
    Math.round(profit).toLocaleString("es-CL"),
    top[0]?.[0] ?? "sin ventas",
    mermaSummary,
    lowStockSummary,
  ];
  const summary = [
    `Reporte Invenco ${reportDate}`,
    `Ventas: ${clp(totalSales)} en ${payments.length} transacciones.`,
    `Ganancia estimada: ${clp(profit)}.`,
    `Mermas: ${waste.length} registros (${mermaSummary}; ${clp(waste.reduce((sum, row) => sum + Number(row.cost_amount), 0))} a costo).`,
    `Más vendidos: ${top.length ? top.map(([name, qty]) => `${name} (${qty})`).join(", ") : "sin ventas"}.`,
    `Productos con stock bajo: ${lowStockSummary}.`,
  ].join("\n");

  const { error: insertError } = await client.from("whatsapp_notifications").upsert(
    {
      notification_type: "daily_report",
      recipient: settings.owner_whatsapp,
      message: summary,
      dedupe_key: `daily-report:${dateString}`,
      metadata: {
        date: dateString,
        sales: totalSales,
        transactions: payments.length,
        template_parameters: templateParameters,
      },
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`No se pudo registrar el reporte: ${insertError.message}`);

  const { data: notification, error: lookupError } = await client
    .from("whatsapp_notifications")
    .select("id, status, metadata")
    .eq("dedupe_key", `daily-report:${dateString}`)
    .single();
  if (lookupError)
    throw new Error(`No se pudo verificar el reporte diario: ${lookupError.message}`);
  const storedParameters = notification.metadata?.["template_parameters"];
  const hasValidParameters =
    Array.isArray(storedParameters) &&
    storedParameters.length === DAILY_REPORT_PARAMETER_COUNT &&
    storedParameters.every((value) => typeof value === "string" && value.trim().length > 0);
  if (notification.status !== "sent" && notification.status !== "sending" && !hasValidParameters) {
    const { error: updateError } = await client
      .from("whatsapp_notifications")
      .update({
        message: summary,
        metadata: {
          date: dateString,
          sales: totalSales,
          transactions: payments.length,
          template_parameters: templateParameters,
        },
      })
      .eq("id", notification.id);
    if (updateError)
      throw new Error(`No se pudo actualizar el reporte diario: ${updateError.message}`);
  }
  return { id: notification.id, status: notification.status, dateString };
}

async function templateFor(notificationType: string) {
  if (notificationType === "daily_report") {
    return {
      name: requiredEnv("WHATSAPP_DAILY_REPORT_TEMPLATE"),
      language: Deno.env.get("WHATSAPP_DAILY_REPORT_LANGUAGE") ?? "es_CL",
    };
  }
  return {
    name: requiredEnv("WHATSAPP_ALERT_TEMPLATE"),
    language: Deno.env.get("WHATSAPP_ALERT_LANGUAGE") ?? "es_CL",
  };
}

async function sendTemplate(notification: Notification) {
  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v22.0";
  const template = await templateFor(notification.notification_type);
  const rawParameters =
    notification.notification_type === "daily_report"
      ? notification.metadata["template_parameters"]
      : [notification.message];
  if (!Array.isArray(rawParameters)) {
    throw new Error(
      "El reporte diario no tiene las variables de plantilla esperadas. Vuelve a generarlo antes de enviarlo.",
    );
  }
  if (
    notification.notification_type === "daily_report" &&
    rawParameters.length !== DAILY_REPORT_PARAMETER_COUNT
  ) {
    throw new Error(
      `La plantilla del reporte diario requiere ${DAILY_REPORT_PARAMETER_COUNT} variables.`,
    );
  }
  const parameters = rawParameters.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("La plantilla contiene una variable vacía o inválida.");
    }
    return { type: "text", text: value.slice(0, 1024) };
  });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: notification.recipient.replace(/\D/g, ""),
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components: [
            {
              type: "body",
              parameters,
            },
          ],
        },
      }),
    },
  );
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = responseBody?.error?.message ?? `Meta respondió HTTP ${response.status}`;
    throw new Error(String(detail));
  }
}

async function processQueue(client: ReturnType<typeof adminClient>, limit = 20) {
  const { data: notifications, error } = await client.rpc("claim_whatsapp_notifications", {
    _limit: limit,
  });
  if (error) throw new Error(`No se pudo procesar la cola de WhatsApp: ${error.message}`);

  let sent = 0;
  let failed = 0;
  for (const row of (notifications ?? []) as Notification[]) {
    try {
      await sendTemplate(row);
      const { error: updateError } = await client
        .from("whatsapp_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      if (updateError)
        throw new Error(
          `Meta envió el mensaje, pero no se pudo actualizar su estado: ${updateError.message}`,
        );
      sent += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido al enviar el mensaje.";
      const { error: updateError } = await client
        .from("whatsapp_notifications")
        .update({ status: "failed", last_error: message })
        .eq("id", row.id);
      if (updateError)
        console.error(`No se pudo registrar el fallo del mensaje ${row.id}:`, updateError.message);
      failed += 1;
    }
  }
  return { sent, failed };
}

async function authorizeAdmin(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: isAdmin, error: roleError } = await client.rpc("has_role", {
    _user_id: data.user.id,
    _role: "admin",
  });
  if (roleError) throw new Error(`No se pudo validar el rol: ${roleError.message}`);
  return isAdmin ? data.user : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método no permitido." }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const client = adminClient();
    const cronSecret = Deno.env.get("WHATSAPP_CRON_SECRET");
    const isScheduled = body.action === "scheduled";
    if (isScheduled) {
      if (!cronSecret || request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
        return jsonResponse({ error: "No autorizado." }, 401);
      }
      const settings = await loadSettings(client);
      let reportQueued = false;
      const now = new Date();
      const chile = localDateTimeParts(now);
      if (
        settings.whatsapp_notifications_enabled &&
        settings.daily_report_enabled &&
        Number(chile["hour"]) === settings.daily_report_hour &&
        settings.last_report_on !== `${chile["year"]}-${chile["month"]}-${chile["day"]}`
      ) {
        await createDailyReport(client, settings, now);
        const { error } = await client
          .from("settings")
          .update({ last_report_on: `${chile["year"]}-${chile["month"]}-${chile["day"]}` })
          .eq("id", 1);
        if (error)
          throw new Error(
            `El reporte quedó en cola, pero no se pudo actualizar la fecha: ${error.message}`,
          );
        reportQueued = true;
      }
      if (settings.whatsapp_notifications_enabled && settings.inventory_alerts_enabled) {
        const { error } = await client.rpc("enqueue_whatsapp_expiry_alerts");
        if (error) throw new Error(`No se pudieron procesar vencimientos: ${error.message}`);
      }
      const result = settings.whatsapp_notifications_enabled
        ? await processQueue(client, 50)
        : { sent: 0, failed: 0 };
      return jsonResponse({ ok: true, reportQueued, ...result });
    }

    const user = await authorizeAdmin(request);
    if (!user)
      return jsonResponse({ error: "Solo administradores pueden gestionar WhatsApp." }, 403);

    if (body.action === "check_connection") {
      const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
      const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
      const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v22.0";
      const response = await fetch(
        `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=id,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const result = await response.json().catch(() => ({}));
      const connected = response.ok;
      const { error } = await client
        .from("settings")
        .update({
          whatsapp_connected: connected,
          whatsapp_last_check_at: new Date().toISOString(),
          whatsapp_last_error: connected
            ? null
            : String(result?.error?.message ?? `Meta respondió HTTP ${response.status}`),
        })
        .eq("id", 1);
      if (error) throw new Error(`No se pudo guardar el estado de conexión: ${error.message}`);
      if (!connected)
        return jsonResponse(
          { error: result?.error?.message ?? "No se pudo conectar con Meta." },
          502,
        );
      return jsonResponse({ connected: true, phone: result.display_phone_number ?? null });
    }

    const settings = await loadSettings(client);
    if (!settings.owner_whatsapp || !/^\+?[1-9]\d{7,14}$/.test(settings.owner_whatsapp)) {
      return jsonResponse(
        { error: "Configura primero un número WhatsApp válido en formato internacional." },
        400,
      );
    }
    if (!settings.whatsapp_notifications_enabled) {
      return jsonResponse(
        { error: "Activa las notificaciones WhatsApp antes de enviar o reintentar mensajes." },
        400,
      );
    }

    if (body.action === "send_report_now") {
      const report = await createDailyReport(client, settings);
      if (report.status === "sent" || report.status === "sending") {
        return jsonResponse({
          ok: true,
          alreadySent: true,
          message: "El reporte diario de hoy ya se envió o está en proceso.",
        });
      }
      const result = await processQueueForId(client, report.id);
      return jsonResponse({ ok: true, ...result });
    }

    if (body.action === "retry" && typeof body.id === "string") {
      const { data: notification, error } = await client
        .from("whatsapp_notifications")
        .select("id, status")
        .eq("id", body.id)
        .single();
      if (error) return jsonResponse({ error: error.message }, 404);
      if (notification.status !== "failed") {
        return jsonResponse({ error: "Solo puedes reintentar mensajes fallidos." }, 400);
      }
      const { error: retryError } = await client
        .from("whatsapp_notifications")
        .update({ status: "pending", last_error: null })
        .eq("id", body.id);
      if (retryError) throw new Error(`No se pudo programar el reintento: ${retryError.message}`);
      return jsonResponse({ ok: true, ...(await processQueueForId(client, body.id)) });
    }

    return jsonResponse({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error inesperado en notificaciones WhatsApp.";
    console.error("[whatsapp-notifications]", message);
    return jsonResponse({ error: message }, 500);
  }
});

async function processQueueForId(client: ReturnType<typeof adminClient>, id: string) {
  const { data: notification, error: lookupError } = await client
    .from("whatsapp_notifications")
    .select("id")
    .eq("id", id)
    .single();
  if (lookupError) throw new Error(`No se encontró la notificación: ${lookupError.message}`);
  const { data: claimed, error } = await client.rpc("claim_whatsapp_notifications", {
    _limit: 1,
    _notification_id: id,
  });
  if (error) throw new Error(`No se pudo procesar la notificación: ${error.message}`);
  if (!(claimed ?? []).some((row: Notification) => row.id === notification.id)) {
    return { sent: 0, failed: 0, message: "El mensaje ya está siendo procesado." };
  }
  const row = (claimed as Notification[]).find((item) => item.id === notification.id)!;
  try {
    await sendTemplate(row);
    const { error: updateError } = await client
      .from("whatsapp_notifications")
      .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id);
    if (updateError)
      throw new Error(`Meta envió el mensaje, pero no se guardó su estado: ${updateError.message}`);
    return { sent: 1, failed: 0 };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al enviar el mensaje.";
    const { error: updateError } = await client
      .from("whatsapp_notifications")
      .update({ status: "failed", last_error: message })
      .eq("id", row.id);
    if (updateError)
      console.error(`No se pudo registrar el fallo del mensaje ${row.id}:`, updateError.message);
    throw new Error(`No se pudo enviar el mensaje: ${message}`);
  }
}
