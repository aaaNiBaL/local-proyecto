import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Invenco" },
      {
        name: "description",
        content:
          "Accede a Invenco, el punto de venta e inventario en tiempo real de tu minimarket.",
      },
      { property: "og:title", content: "Iniciar sesión — Invenco" },
      {
        property: "og:description",
        content: "Punto de venta e inventario perpetuo para minimarkets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const recoveryMode = useRef(false);

  useEffect(() => {
    recoveryMode.current =
      new URLSearchParams(window.location.search).get("mode") === "reset" ||
      window.location.hash.includes("type=recovery") ||
      window.location.hash.includes("type=invite");
    if (recoveryMode.current) setMode("reset");
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !recoveryMode.current) navigate({ to: "/vender", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode.current = true;
        setMode("reset");
      } else if (event === "SIGNED_IN" && session && !recoveryMode.current) {
        navigate({ to: "/vender", replace: true });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Contraseña actualizada. Ya puedes iniciar sesión.");
        recoveryMode.current = false;
        setMode("login");
        setPassword("");
        navigate({ to: "/auth", replace: true });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (data.session) navigate({ to: "/vender", replace: true });
        else toast.success("Cuenta creada. Revisa tu correo para confirmarla.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/vender", replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? translate(err.message) : "Error al iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) toast.error(`Google: ${error.message}`);
  };

  const sendPasswordReset = async () => {
    if (!email.trim()) {
      toast.error("Escribe tu correo para enviarte el enlace de recuperación.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?mode=reset`,
      });
      if (error) throw error;
      toast.success(
        "Si el correo está registrado, recibirás un enlace para restablecer la contraseña.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el enlace.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Store className="size-6" />
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight">Invenco</p>
            <p className="text-xs text-muted-foreground">POS e inventario en tiempo real</p>
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">
            {mode === "login"
              ? "Iniciar sesión"
              : mode === "signup"
                ? "Crear cuenta"
                : "Restablecer contraseña"}
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {mode === "login"
              ? "Ingresa con tu cuenta del local."
              : mode === "signup"
                ? "El primer usuario será el administrador."
                : "Ingresa una nueva contraseña para tu cuenta."}
          </p>
          {mode !== "reset" && (
            <Button variant="outline" className="w-full" onClick={google} type="button">
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
                />
              </svg>
              Continuar con Google
            </Button>
          )}
          {mode !== "reset" && (
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> o con correo{" "}
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={mode === "reset"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">
                {mode === "reset" ? "Nueva contraseña" : "Contraseña"}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Crear cuenta"
                    : "Actualizar contraseña"}
            </Button>
          </form>
          {mode === "login" && (
            <button
              type="button"
              className="mt-3 w-full text-center text-sm text-primary hover:underline"
              onClick={sendPasswordReset}
              disabled={busy}
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}
          {mode !== "reset" && (
            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login"
                ? "¿No tienes cuenta? Crear una"
                : "¿Ya tienes cuenta? Iniciar sesión"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function translate(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
  if (/already registered/i.test(msg)) return "Ese correo ya está registrado.";
  if (/email not confirmed/i.test(msg)) return "Confirma tu correo antes de entrar.";
  return msg;
}
