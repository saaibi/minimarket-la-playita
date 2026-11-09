const raw = process.env.VITE_API_URL;
if (!raw) throw Error("VITE_API_URL HTTPS de pruebas es obligatorio");
const url = new URL(raw);
if (
  url.protocol !== "https:" ||
  ["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2", "[::1]"].includes(
    url.hostname,
  ) ||
  url.hostname.endsWith(".invalid")
)
  throw Error(
    "Usa un endpoint HTTPS real alcanzable desde el teléfono; no localhost ni marcadores .invalid",
  );
console.log(
  "Formato de API móvil válido. No verifica conectividad, certificado, cuenta ni despliega el servicio.",
);
