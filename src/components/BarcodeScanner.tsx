import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Código detectado por cámara o lector físico */
  onDetect: (code: string) => void;
};

const REGION_ID = "invenco-scanner-region";

/**
 * ESCANEAR PRODUCTO — escaneo con cámara (barras / QR) y captura
 * directa de lectores físicos USB o Bluetooth (actúan como teclado).
 */
export function BarcodeScanner({ open, onOpenChange, onDetect }: Props) {
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lector físico: los lectores USB/Bluetooth "tipean" rápido y terminan en Enter.
  useEffect(() => {
    if (!open) return;
    const isTypingTarget = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (bufferRef.current.length >= 4) {
          const code = bufferRef.current;
          bufferRef.current = "";
          onDetect(code);
        }
        return;
      }
      if (e.key.length === 1 && !isTypingTarget(e.target)) {
        bufferRef.current += e.key;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => (bufferRef.current = ""), 120);
        if (bufferRef.current.length > 64) bufferRef.current = bufferRef.current.slice(-64);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current = "";
    };
  }, [open, onDetect]);

  // Cámara
  useEffect(() => {
    if (!open || !cameraOn) return;
    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    scannerRef.current = scanner;
    let stopped = false;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 180 } },
        (decoded) => {
          if (stopped) return;
          stopped = true;
          void scanner.stop().catch(() => { });
          onDetect(decoded.trim());
        },
        () => { },
      )
      .catch(() => {
        setCameraError(
          "No se pudo abrir la cámara. Revisa los permisos del navegador o usa un lector físico.",
        );
        setCameraOn(false);
      });
    return () => {
      scannerRef.current = null;
      scanner.stop().catch(() => { });
    };
  }, [open, cameraOn, onDetect]);

  useEffect(() => {
    if (!open) {
      setCameraOn(false);
      setCameraError(null);
      setManual("");
    }
  }, [open]);

  const stopCamera = () => {
    scannerRef.current?.stop().catch(() => { });
    setCameraOn(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase">Escanear producto</DialogTitle>
          <DialogDescription>
            Apunta la cámara al código de barras o QR, o usa un lector USB / Bluetooth apuntando a
            esta ventana.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            id={REGION_ID}
            className="mx-auto min-h-40 w-full overflow-hidden rounded-lg border bg-muted/40"
          >
            {!cameraOn && (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                <ScanLine className="size-8" />
                <span className="text-sm">Cámara apagada</span>
              </div>
            )}
          </div>
          {cameraError && <p className="text-sm text-destructive">{cameraError}</p>}

          <div className="flex justify-center gap-2">
            {!cameraOn ? (
              <Button size="lg" onClick={() => { setCameraError(null); setCameraOn(true); }}>
                <Camera className="size-5" /> Encender cámara
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={stopCamera}>
                <X className="size-5" /> Apagar cámara
              </Button>
            )}
          </div>

          <div className="space-y-1.5 border-t pt-4">
            <Label className="flex items-center gap-1.5">
              <Keyboard className="size-4" /> Ingreso manual
            </Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = manual.trim();
                if (code) {
                  setManual("");
                  onDetect(code);
                }
              }}
            >
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Escribe o dispara el lector aquí…"
                inputMode="numeric"
              />
              <Button type="submit" variant="secondary">
                Buscar
              </Button>
            </form>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
