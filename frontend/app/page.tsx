import { ZenyApp } from "./components/ZenyApp";

// `?demo=1` carga un estado de ejemplo (app/fixtures.ts) para revisar el diseño sin backend.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1" || sp.demo === "true";
  // `?q=...` lanza esa pregunta al cargar (útil para enlaces/QR en la expo).
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim().slice(0, 500) : undefined;
  return <ZenyApp demo={demo} preguntaInicial={q} />;
}
