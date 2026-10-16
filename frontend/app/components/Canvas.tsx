"use client";

import Image from "next/image";
import type { CanvasState } from "../lib/useZenyCanvas";
import { ChartCard } from "./ChartCard";
import { IconSparkle } from "./icons";

export const SUGERENCIAS = [
  "¿Cómo le fue a la planta en septiembre?",
  "¿Hay trackers con problemas?",
  "Compara la energía generada con la radiación solar",
  "¿Qué tan confiables son los datos de la estación meteorológica?",
];

function SkeletonCard({ texto }: { texto: string }) {
  return (
    <div className="anim-card-in flex min-h-[260px] flex-col gap-4 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface/70 p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-accent-ink">
        <span className="spinner spinner-sm" />
        {texto}
      </div>
      <div className="skeleton h-5 w-2/3 rounded-md" />
      <div className="skeleton h-3 w-1/3 rounded-md" />
      <div className="skeleton mt-2 flex-1 rounded-xl" />
    </div>
  );
}

function Vacio({ running, onPreguntar }: { running: boolean; onPreguntar: (q: string) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div className="relative">
        <div className="absolute inset-x-6 bottom-0 h-8 rounded-[50%] bg-black/10 blur-md" />
        <Image
          src="/brand/Zeny.webp"
          alt="Zeny, la mascota de Zentrack"
          width={889}
          height={1024}
          priority
          className="anim-float relative h-auto w-[180px] sm:w-[220px]"
        />
      </div>
      <h2 className="font-display mt-6 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {running ? "Estoy revisando los datos…" : "¡Hola! Soy Zeny"}
      </h2>
      <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-ink-2">
        {running
          ? "En unos segundos empezarán a aparecer aquí las gráficas que voy creando."
          : "Analizo la minigranja solar Joropo. Hazme una pregunta y dibujaré aquí las gráficas mientras investigo."}
      </p>
      {!running ? (
        <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPreguntar(s)}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left text-[15px] font-medium text-ink shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-accent hover:bg-accent-soft active:translate-y-0"
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink transition group-hover:bg-accent group-hover:text-white">
                <IconSparkle size={15} />
              </span>
              <span className="leading-snug">{s}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-8 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          <SkeletonCard texto="Consultando la base de datos…" />
          <SkeletonCard texto="Preparando gráfica…" />
        </div>
      )}
    </div>
  );
}

export function Canvas({
  canvas,
  running,
  onPreguntar,
}: {
  canvas: CanvasState;
  running: boolean;
  onPreguntar: (q: string) => void;
}) {
  const ids = Object.keys(canvas.charts).sort((a, b) => (canvas.orden[b] ?? 0) - (canvas.orden[a] ?? 0));

  if (ids.length === 0) return <Vacio running={running} onPreguntar={onPreguntar} />;

  return (
    <div className="@container">
      <div className="grid grid-flow-row-dense grid-cols-1 gap-5 @4xl:grid-cols-2 @[110rem]:grid-cols-3">
        {running ? (
          <div className="col-span-full">
            <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-[14px] text-ink">
              <span className="spinner" />
              <span>
                <strong className="font-semibold">Zeny sigue trabajando.</strong> Las nuevas gráficas aparecerán
                aquí arriba.
              </span>
            </div>
          </div>
        ) : null}
        {ids.map((id) => {
          const c = canvas.charts[id];
          const ancha = c.tipo === "kpi" || c.tipo === "mapa_calor" || (c.datos?.length ?? 0) > 400;
          return (
            <div key={id} className={ancha ? "col-span-full min-w-0" : "min-w-0"}>
              <ChartCard chart={c} actualizada={canvas.actualizada[id]} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
