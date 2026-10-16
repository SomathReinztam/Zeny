"use client";

import { memo, useState } from "react";
import type { Chart, Severidad } from "../lib/types";
import { fmtCreado } from "../lib/format";
import { ChartPlot } from "./ChartPlot";
import { DataTable } from "./DataTable";
import { KpiRow } from "./KpiRow";
import { IconAlert, IconBot, IconBulb, IconChart, IconChevron, IconCode, IconCopy, IconOctagon, IconTable } from "./icons";

const SEV: Record<Severidad, { label: string; color: string; soft: string; Icon: typeof IconBulb }> = {
  info: { label: "Hallazgo", color: "var(--brand-orange-ink)", soft: "var(--accent-soft)", Icon: IconBulb },
  alerta: { label: "Atención", color: "var(--warn)", soft: "var(--warn-soft)", Icon: IconAlert },
  critico: { label: "Crítico", color: "var(--crit)", soft: "var(--crit-soft)", Icon: IconOctagon },
};

function ChartCardImpl({ chart, actualizada }: { chart: Chart; actualizada?: number }) {
  const [verDatos, setVerDatos] = useState(false);
  const [verSql, setVerSql] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const sev = SEV[chart.severidad ?? "info"] ?? SEV.info;
  const graficable = chart.tipo !== "kpi" && chart.tipo !== "tabla";
  // El botón "Datos" (tabla cruda) solo si hay filas: el medidor no trae `datos`.
  const tieneDatos = (chart.datos?.length ?? 0) > 0;

  const copiar = async () => {
    if (!chart.sql) return;
    try {
      await navigator.clipboard.writeText(chart.sql);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sin permisos de portapapeles */
    }
  };

  return (
    <article
      className="anim-card-in relative flex min-w-0 flex-col rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-card)]"
      aria-label={chart.titulo}
    >
      {actualizada ? <span key={actualizada} className="card-flash" /> : null}

      <header className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[1.15rem] font-semibold leading-snug text-ink">{chart.titulo}</h3>
          {chart.subtitulo ? <p className="mt-0.5 text-[13px] text-ink-3">{chart.subtitulo}</p> : null}
        </div>
        {graficable && tieneDatos ? (
          <button
            type="button"
            onClick={() => setVerDatos((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-accent hover:bg-accent-soft"
            aria-pressed={verDatos}
            title={verDatos ? "Ver gráfica" : "Ver datos en tabla"}
          >
            {verDatos ? <IconChart size={14} /> : <IconTable size={14} />}
            {verDatos ? "Gráfica" : "Datos"}
          </button>
        ) : null}
      </header>

      <div className="min-w-0 px-4 pt-3 pb-1">
        {chart.tipo === "kpi" ? (
          <div className="px-1">
            <KpiRow kpis={chart.kpis ?? []} />
          </div>
        ) : chart.tipo === "tabla" || verDatos ? (
          <div className="px-1">
            <DataTable chart={chart} />
          </div>
        ) : (
          <ChartPlot chart={chart} />
        )}
      </div>

      {chart.insight ? (
        <div
          className="mx-5 mt-3 flex gap-3 rounded-xl px-4 py-3"
          style={{ background: sev.soft, borderLeft: `4px solid ${sev.color}` }}
        >
          <sev.Icon size={18} style={{ color: sev.color, flex: "none", marginTop: 2 }} />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: sev.color }}>
              {sev.label}
            </div>
            <p className="mt-0.5 text-[14.5px] leading-relaxed text-ink">{chart.insight}</p>
          </div>
        </div>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <IconBot size={14} />
          <span className="font-medium text-ink-2">{chart.autor || "zeny"}</span>
        </span>
        {chart.creado_en ? <span>· {fmtCreado(chart.creado_en)}</span> : null}
        {chart.sql ? (
          <button
            type="button"
            onClick={() => setVerSql((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-ink-2 transition hover:bg-sunk"
            aria-expanded={verSql}
          >
            <IconCode size={14} />
            {verSql ? "Ocultar SQL" : "Ver SQL"}
            <IconChevron size={14} style={{ transform: verSql ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
          </button>
        ) : null}
      </footer>

      {chart.sql && verSql ? (
        <div className="relative mx-4 mb-4 rounded-xl bg-[#1a1a1a]">
          <button
            type="button"
            onClick={copiar}
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11.5px] text-[#f2f2f2] hover:bg-white/20"
          >
            <IconCopy size={12} />
            {copiado ? "Copiado" : "Copiar"}
          </button>
          <pre className="scroll-thin max-h-72 overflow-auto p-4 pr-20 font-mono text-[12.5px] leading-relaxed text-[#f2f2f2]">
            <code>{chart.sql}</code>
          </pre>
        </div>
      ) : null}
    </article>
  );
}

export const ChartCard = memo(ChartCardImpl);
