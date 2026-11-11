import React, { useEffect, useRef, useState } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";
import { auth } from "./session.js";
import { SessionError } from "@playita/mobile";
import { Modal } from "./ui.js";
const GoogleNative = registerPlugin<{
  signIn(options: {
    clientId: string;
    nonce: string;
  }): Promise<{ credential: string }>;
}>("PlayitaGoogle");
type Challenge = { clientId: string; nonce: string };
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
function WebGoogle({
  challenge,
  complete,
  fail,
}: {
  challenge: Challenge;
  complete: (token: string) => void;
  fail: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void loadSdk()
      .then((google) => {
        if (!active || !ref.current) return;
        google.accounts.id.initialize({
          client_id: challenge.clientId,
          nonce: challenge.nonce,
          auto_select: false,
          callback: (data) => {
            if (active) complete(data.credential);
          },
        });
        google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          locale: "es",
          width: 280,
        });
      })
      .catch(() => {
        if (active) fail();
      });
    return () => {
      active = false;
    };
  }, [challenge]);
  return <div ref={ref} aria-label="Elegir cuenta de Google" />;
}
export function GoogleLogin({
  disabled,
  onBusy,
}: {
  disabled: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [available, setAvailable] = useState(false),
    [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{
    challenge: Challenge;
    resolve: (token: string) => void;
    reject: () => void;
  } | null>(null);
  const pending = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    void auth
      .googleOptions()
      .then((v) => {
        if (active)
          setAvailable(
            v.available &&
              !!v.clientId &&
              (!Capacitor.isNativePlatform() ||
                Capacitor.getPlatform() === "android"),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
      pending.current();
    };
  }, []);
  async function login() {
    onBusy(true);
    setError("");
    try {
      await auth.google(async (challenge) => {
        if (Capacitor.isNativePlatform())
          return (await GoogleNative.signIn(challenge)).credential;
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => cancel(), 120000);
          const cancel = () => {
            clearTimeout(timer);
            setPrompt(null);
            reject(Error("GOOGLE_CANCELLED"));
          };
          pending.current = cancel;
          setPrompt({
            challenge,
            resolve: (token) => {
              clearTimeout(timer);
              setPrompt(null);
              resolve(token);
            },
            reject: cancel,
          });
        });
      });
    } catch (e) {
      setError(
        e instanceof SessionError &&
          e.code === "ACCOUNT_EXISTS_USE_EXISTING_LOGIN"
          ? "Ese correo ya tiene una cuenta. Usa su forma de acceso habitual; no vinculamos cuentas automáticamente."
          : "No fue posible entrar con Google. Puedes reintentar o continuar como invitado.",
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <button disabled={disabled || !available} onClick={() => void login()}>
        {available
          ? "Continuar con Google"
          : "Continuar con Google · pendiente de configuración"}
      </button>
      {error && <p role="alert">{error}</p>}
      {prompt && (
        <Modal title="Iniciar sesión con Google" close={prompt.reject}>
          <p>Elige tu cuenta para acceder como comprador.</p>
          <WebGoogle
            challenge={prompt.challenge}
            complete={prompt.resolve}
            fail={prompt.reject}
          />
          <button onClick={prompt.reject}>Cancelar</button>
        </Modal>
      )}
    </>
  );
}
