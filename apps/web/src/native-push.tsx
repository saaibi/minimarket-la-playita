import React, { useEffect, useRef, useState } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { auth, native } from "./session.js";
import { Button } from "./material.js";
const android = native && Capacitor.getPlatform() === "android";
export type NativePushPlatform = {
  android: boolean;
  api: typeof PushNotifications;
};
const defaultPlatform: NativePushPlatform = { android, api: PushNotifications };
const preference = (owner: string) => "playita-push-enabled:" + owner;
function installationId() {
  let id = localStorage.getItem("playita-push-installation");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("playita-push-installation", id);
  }
  return id;
}
let nativeOperations: Promise<unknown> = Promise.resolve();
function nativeOperation<T>(fn: () => Promise<T>): Promise<T> {
  const next = nativeOperations.then(fn, fn);
  nativeOperations = next.catch(() => {});
  return next;
}
export async function disconnectNativePush(
  owner: string,
  platform: NativePushPlatform = defaultPlatform,
) {
  if (!platform.android) return;
  const id = localStorage.getItem("playita-push-installation");
  await nativeOperation(async () => {
    if (auth.current?.actor.id !== owner) return;
    const outcomes = await Promise.allSettled([
      id
        ? auth
            .request(
              "/push/devices/unregister",
              { method: "POST", body: JSON.stringify({ installationId: id }) },
              owner,
            )
            .then((response) => {
              if (!response.ok) throw Error("UNREGISTER_FAILED");
            })
        : Promise.resolve(),
      platform.api.unregister(),
    ]);
    if (outcomes.every((result) => result.status === "rejected"))
      throw Error("UNREGISTER_FAILED");
  });
}
export function useNativePush(
  owner: string,
  guest: boolean,
  authenticated: boolean,
  onOpen: (orderId: string, eventId: string) => Promise<void>,
  onReceive: () => Promise<void>,
  platform: NativePushPlatform = defaultPlatform,
) {
  const [available, setAvailable] = useState(false),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false);
  const callbacks = useRef({ onOpen, onReceive });
  callbacks.current = { onOpen, onReceive };
  const handles = useRef<PluginListenerHandle[]>([]),
    generation = useRef(0),
    wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setAvailable(false);
    setReady(false);
    setEnabled(false);
    setMessage("");
    setBusy(false);
    if (!platform.android || guest || !authenticated) return;
    const own = ++generation.current;
    let active = true;
    const valid = () =>
      active && generation.current === own && auth.current?.actor.id === owner;
    const add = async (handle: Promise<PluginListenerHandle>) => {
      const h = await handle;
      if (active) handles.current.push(h);
      else await h.remove();
    };
    void (async () => {
      const response = await auth.request("/push/options", {}, owner);
      if (!response.ok || !(await response.json()).available || !valid())
        return;
      await add(
        platform.api.addListener("registration", (token) => {
          if (!valid() || localStorage.getItem(preference(owner)) !== "true")
            return;
          void nativeOperation(async () => {
            if (!valid() || localStorage.getItem(preference(owner)) !== "true")
              return;
            const r = await auth.request(
              "/push/devices",
              {
                method: "POST",
                body: JSON.stringify({
                  installationId: installationId(),
                  token: token.value,
                }),
              },
              owner,
            );
            if (!r.ok) throw Error("registration failed");
            if (valid() && localStorage.getItem(preference(owner)) === "true") {
              setEnabled(true);
              setMessage("Avisos activados en este teléfono.");
            }
          })
            .catch(() => {
              if (valid())
                setMessage(
                  "No se pudieron activar los avisos. Inténtalo de nuevo.",
                );
            })
            .finally(() => {
              if (valid()) {
                if (wait.current) clearTimeout(wait.current);
                setBusy(false);
              }
            });
        }),
      );
      await add(
        platform.api.addListener("registrationError", () => {
          if (valid()) {
            if (wait.current) clearTimeout(wait.current);
            setBusy(false);
            setMessage(
              "No se pudieron activar los avisos. Inténtalo de nuevo.",
            );
          }
        }),
      );
      await add(
        platform.api.addListener("pushNotificationReceived", () => {
          if (valid()) void callbacks.current.onReceive().catch(() => {});
        }),
      );
      await add(
        platform.api.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const data = action.notification.data;
            if (
              valid() &&
              /^[0-9a-f-]{36}$/.test(data?.orderId || "") &&
              /^\d{1,18}$/.test(data?.eventId || "")
            )
              void callbacks.current
                .onOpen(data.orderId, data.eventId)
                .catch(() => {
                  if (valid())
                    setMessage("Abre Pedidos para consultar la actualización.");
                });
          },
        ),
      );
      if (!valid()) return;
      await platform.api.createChannel({
        id: "playita_orders",
        name: "Pedidos de La Playita",
        description: "Nuevos pedidos y cambios de estado",
        importance: 4,
        visibility: 0,
      });
      if (!valid()) return;
      setReady(true);
      setAvailable(true);
      const permission = await platform.api.checkPermissions();
      if (valid() && localStorage.getItem(preference(owner)) === "false") {
        await disconnectNativePush(owner, platform).catch(() => {
          if (valid()) {
            setEnabled(true);
            setMessage(
              "No se pudieron desactivar los avisos. Reintenta o desactívalos en los ajustes de Android.",
            );
          }
        });
      }
      if (
        valid() &&
        permission.receive === "granted" &&
        localStorage.getItem(preference(owner)) === "true"
      )
        await nativeOperation(() => platform.api.register());
    })().catch(() => {
      if (valid())
        setMessage("No se pudieron consultar los avisos del teléfono.");
    });
    return () => {
      active = false;
      generation.current++;
      if (wait.current) clearTimeout(wait.current);
      for (const h of handles.current) void h.remove();
      handles.current = [];
    };
  }, [owner, guest, authenticated, platform]);
  async function activate() {
    if (!ready || busy) return;
    setBusy(true);
    setMessage("");
    const ownGeneration = generation.current;
    try {
      let permission = await platform.api.checkPermissions();
      if (
        permission.receive === "prompt" ||
        permission.receive === "prompt-with-rationale"
      )
        permission = await platform.api.requestPermissions();
      if (permission.receive !== "granted") {
        setMessage(
          "Permiso no concedido. Puedes habilitarlo en los ajustes de Android.",
        );
        setBusy(false);
        return;
      }
      if (
        generation.current !== ownGeneration ||
        auth.current?.actor.id !== owner
      )
        return;
      localStorage.setItem(preference(owner), "true");
      wait.current = setTimeout(() => {
        setBusy(false);
        setMessage("La activación tardó demasiado. Vuelve a intentarlo.");
      }, 15000);
      await nativeOperation(() => platform.api.register());
    } catch {
      if (wait.current) clearTimeout(wait.current);
      setBusy(false);
      setMessage("No se pudieron activar los avisos. Inténtalo de nuevo.");
    }
  }
  async function deactivate() {
    setBusy(true);
    localStorage.setItem(preference(owner), "false");
    try {
      await disconnectNativePush(owner, platform);
      setEnabled(false);
      setMessage("Avisos desactivados en este teléfono.");
    } catch {
      setMessage(
        "No se pudieron desactivar los avisos. Reintenta o desactívalos en los ajustes de Android.",
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    visible: platform.android && !guest && available,
    enabled,
    busy,
    message,
    activate,
    deactivate,
  };
}
export function NativePushControl({
  push,
}: {
  push: ReturnType<typeof useNativePush>;
}) {
  if (!push.visible) return null;
  return (
    <section className="phone-notifications">
      <p>Avisos en este teléfono</p>
      <Button
        disabled={push.busy}
        onClick={() =>
          void (push.enabled ? push.deactivate() : push.activate())
        }
      >
        {push.busy
          ? "Activando…"
          : push.enabled
            ? "Desactivar avisos"
            : "Activar avisos"}
      </Button>
      {push.message && <small role="status">{push.message}</small>}
    </section>
  );
}
