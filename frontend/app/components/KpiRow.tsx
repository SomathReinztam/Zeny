import type { Kpi, KpiEstado } from "../lib/types";
import { fmtNum } from "../lib/format";
import { IconAlert, IconCheck, IconOctagon } from "./icons";

const ESTADO: Record<KpiEstado, { label: string; color: string; soft: string; Icon: typeof IconCheck }> = {
  ok: { label: "Bien", color: "var(--ok)", soft: "var(--ok-soft)", Icon: IconCheck },
  alerta: { label: "Atención", color: "var(--warn)", soft: "var(--warn-soft)", Icon: IconAlert },
  critico: { label: "Crítico", color: "var(--crit)", soft: "var(--crit-soft)", Icon: IconOctagon },
};

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  if (!kpis.length) {
    return <div className="text-sm text-ink-3">Sin indicadores</div>;
  }
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      {kpis.map((k, i) => {
        const e = k.estado ? ESTADO[k.estado] : null;
        const valor =
          k.valor === null || k.valor === undefined
            ? "—"
            : typeof k.valor === "number"
              ? fmtNum(k.valor)
              : k.valor;
        return (
          <div
            key={`${k.etiqueta}-${i}`}
            className="relative overflow-hidden rounded-xl border p-4"
            style={{
              borderColor: e ? `color-mix(in srgb, ${e.color} 28%, var(--line))` : "var(--line)",
              background: e
                ? `linear-gradient(160deg, ${e.soft} 0%, var(--surface) 75%)`
                : "var(--surface-2)",
            }}
          >
            <span
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: e ? e.color : "var(--line-strong)" }}
            />
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
              <div className="text-[13px] font-medium leading-tight text-ink-2">{k.etiqueta}</div>
              {e ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ color: e.color, background: e.soft }}
                >
                  <e.Icon size={12} strokeWidth={2.5} />
                  {e.label}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-[2.1rem] font-semibold leading-none tracking-tight tabular text-ink">
                {valor}
              </span>
              {k.unidad ? <span className="text-base font-medium text-ink-3">{k.unidad}</span> : null}
            </div>
            {k.detalle ? <div className="mt-2 text-[12.5px] leading-snug text-ink-3">{k.detalle}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
