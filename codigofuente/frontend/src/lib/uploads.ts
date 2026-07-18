import api from "./api";
import { notify } from "./notify";

/**
 * Downloads a private upload (behind JWT) and triggers a browser save.
 * A plain `<a href>` cannot be used because the endpoint requires the bearer
 * token, so the blob is fetched through the authenticated `api` client first.
 */
export async function downloadUpload(path: string, filename?: string) {
  try {
    const res = await api.get(`/uploads/${path}`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || path.split("/").pop() || "archivo";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch {
    notify.error("No se pudo descargar el archivo");
  }
}
