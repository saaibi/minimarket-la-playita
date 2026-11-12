import { Button, Input } from "./material.js";
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera, EncodingType } from "@capacitor/camera";

export async function compressProductPhoto(file: Blob): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20000000
  )
    throw Error("Elige una foto JPG, PNG o WebP de hasta 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error("No fue posible leer la foto."));
    });
    const scale = Math.min(
      1,
      640 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("No fue posible preparar la foto.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.75, 0.6, 0.45, 0.3]) {
      const photo = canvas.toDataURL("image/jpeg", quality);
      if (photo.startsWith("data:image/jpeg;base64,") && photo.length <= 300000)
        return photo;
    }
    throw Error(
      "La foto sigue siendo demasiado grande. Prueba con otra imagen.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function ProductPhoto({
  photo,
  onChange,
  onBusy,
}: {
  photo: string;
  onChange: (value: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const upload = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    operation = useRef(0);
  const [activeCamera, setActiveCamera] = useState(false),
    [working, setWorking] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const busy = (value: boolean) => {
    setWorking(value);
    onBusy(value);
  };
  function stop() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setActiveCamera(false);
    setReady(false);
  }
  useEffect(
    () => () => {
      operation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  useEffect(() => {
    if (activeCamera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => {});
    }
  }, [activeCamera]);
  async function usePhoto(file: Blob, id: number) {
    try {
      const value = await compressProductPhoto(file);
      if (id === operation.current) {
        onChange(value);
        setError("");
      }
    } catch (e) {
      if (id === operation.current)
        setError(
          e instanceof Error ? e.message : "No fue posible preparar la foto.",
        );
    } finally {
      if (id === operation.current) busy(false);
    }
  }
  async function takePhoto() {
    const id = ++operation.current;
    setError("");
    busy(true);
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Camera.takePhoto({
          quality: 80,
          targetWidth: 1280,
          targetHeight: 1280,
          encodingType: EncodingType.JPEG,
          saveToGallery: false,
          includeMetadata: false,
          editable: "no",
        });
        if (id !== operation.current) return;
        const path =
          result.webPath ||
          (result.uri ? Capacitor.convertFileSrc(result.uri) : "");
        if (!path) throw Error("No photo");
        const response = await fetch(path);
        if (!response.ok) throw Error("No photo");
        await usePhoto(await response.blob(), id);
      } catch {
        if (id === operation.current) {
          setError(
            "No se tomó ninguna foto. Puedes reintentar o cargar un archivo.",
          );
          busy(false);
        }
      }
      return;
    }
    setActiveCamera(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error("unsupported");
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (id !== operation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        void video.current.play().catch(() => {});
      }
    } catch (e) {
      if (id === operation.current) {
        stop();
        busy(false);
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Permite el acceso a la cámara o carga un archivo."
            : "No se pudo abrir una cámara en este dispositivo. Puedes cargar un archivo.",
        );
      }
    }
  }
  function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const canvas = document.createElement("canvas"),
      scale = Math.min(
        1,
        1280 / Math.max(source.videoWidth, source.videoHeight),
      );
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("No fue posible tomar la foto.");
      return;
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const id = operation.current;
    canvas.toBlob(
      (blob) => {
        if (blob && id === operation.current) {
          stop();
          void usePhoto(blob, id);
        }
      },
      "image/jpeg",
      0.85,
    );
  }
  return (
    <fieldset className="product-photo">
      <legend>Foto opcional</legend>
      <div className="photo-actions">
        <Button
          type="button"
          disabled={working}
          onClick={() => upload.current?.click()}
        >
          Cargar archivo
        </Button>
        <Button
          type="button"
          disabled={working}
          onClick={() => void takePhoto()}
        >
          Tomar foto
        </Button>
      </div>
      <Input
        ref={upload}
        type="file"
        hidden
        aria-label="Seleccionar archivo de foto"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            const id = ++operation.current;
            setError("");
            busy(true);
            void usePhoto(file, id);
          }
        }}
      />
      <small>JPG, PNG o WebP, hasta 20 MB. Se comprime antes de guardar.</small>
      {activeCamera && (
        <div
          className="camera-preview"
          role="group"
          aria-label="Cámara del producto"
        >
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={() => setReady(true)}
            aria-label="Vista previa de cámara"
          />
          <div className="photo-actions">
            <Button type="button" disabled={!ready} onClick={capture}>
              Capturar foto
            </Button>
            <Button
              type="button"
              onClick={() => {
                operation.current++;
                stop();
                busy(false);
              }}
            >
              Cancelar cámara
            </Button>
          </div>
        </div>
      )}
      {working && !activeCamera && <p role="status">Preparando foto…</p>}
      {photo && (
        <div>
          <img
            className="photo-preview"
            src={photo}
            alt="Vista previa del producto"
          />
          <Button type="button" disabled={working} onClick={() => onChange("")}>
            Quitar foto
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
