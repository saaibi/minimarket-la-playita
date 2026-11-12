import { Button } from "./material.js";
import React, { useEffect, useRef, useState } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";
import { auth } from "./session.js";
import { SessionError } from "@playita/mobile";
const GoogleNative = registerPlugin<{
  signIn(options: {
    clientId: string;
    nonce: string;
  }): Promise<{ credential: string }>;
}>("PlayitaGoogle");
type GoogleSdk = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        auto_select: boolean;
        callback: (data: { credential: string }) => void;
      }): void;
      renderButton(
        element: HTMLElement,
        options: Record<string, unknown>,
      ): void;
    };
  };
};
let sdk: Promise<GoogleSdk> | undefined;
function loadSdk(): Promise<GoogleSdk> {
  if (sdk) return sdk;
  sdk = new Promise<GoogleSdk>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      script.remove();
      reject(Error("GOOGLE_UNAVAILABLE"));
    }, 10000);
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      const google = (window as unknown as { google?: GoogleSdk }).google;
      google ? resolve(google) : reject(Error("GOOGLE_UNAVAILABLE"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(Error("GOOGLE_UNAVAILABLE"));
    };
    document.head.append(script);
  }).catch((e) => {
    sdk = undefined;
    throw e;
  });
  return sdk!;
}
function googleError(error: unknown) {
  return error instanceof SessionError &&
    error.code === "ACCOUNT_EXISTS_USE_EXISTING_LOGIN"
    ? "No se pudo vincular esa cuenta de Google. Usa tu acceso habitual o consulta al administrador."
    : "No fue posible entrar con Google. Puedes reintentar o continuar como invitado.";
}
export function GoogleLogin({
  disabled,
  onBusy,
}: {
  disabled: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [available, setAvailable] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null),
    disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    let active = true;
    void auth
      .googleOptions()
      .then((options) => {
        if (active)
          setAvailable(
            options.available &&
              !!options.clientId &&
              (!native || Capacitor.getPlatform() === "android"),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!available || native) return;
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    setReady(false);
    // Prepare nonce before the user clicks, so Google's button opens its picker directly.
    void Promise.all([loadSdk(), auth.prepareGoogle()])
      .then(([google, challenge]) => {
        if (!active || !ref.current) return;
        google.accounts.id.initialize({
          client_id: challenge.clientId,
          nonce: challenge.nonce,
          auto_select: false,
          callback: (data) => {
            if (!active || disabledRef.current) return;
            clearTimeout(timer);
            onBusy(true);
            setError("");
            void auth
              .completeGoogle(challenge, data.credential)
              .catch((e) => {
                if (active) setError(googleError(e));
              })
              .finally(() => {
                if (active) {
                  onBusy(false);
                  setAttempt((v) => v + 1);
                }
              });
          },
        });
        ref.current.replaceChildren();
        google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          type: "icon",
          shape: "circle",
          locale: "es",
        });
        setReady(true);
        timer = setTimeout(() => {
          if (active) setAttempt((v) => v + 1);
        }, 240000);
      })
      .catch(() => {
        if (active)
          setError(
            "No fue posible cargar Google. Pulsa el logo para reintentar.",
          );
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [available, attempt]);
  async function nativeLogin() {
    onBusy(true);
    setError("");
    try {
      await auth.google(
        async (challenge) => (await GoogleNative.signIn(challenge)).credential,
      );
    } catch (e) {
      setError(googleError(e));
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      {!native && available && (
        <div
          className="google-web-button"
          ref={ref}
          hidden={!ready}
          inert={disabled}
          aria-label="Acceder con Google"
        />
      )}
      {(native || !ready) && (
        <Button
          className="google-button"
          aria-label="Acceder con Google"
          title={
            available
              ? "Acceder con Google"
              : "Google pendiente de conexión o configuración"
          }
          disabled={disabled || !available || (!native && !error)}
          onClick={() =>
            native ? void nativeLogin() : setAttempt((v) => v + 1)
          }
        >
          <img src="/assets/google-g.png" alt="" aria-hidden="true" />
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
