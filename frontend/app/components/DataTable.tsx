import type { Chart } from "../lib/types";
import { fmtNum, fmtTiempoCompacto } from "../lib/format";

const MAX_FILAS = 500;

export function DataTable({ chart, maxHeight = 340 }: { chart: Chart; maxHeight?: number }) {
  const datos = chart.datos ?? [];
  const series = chart.series ?? [];

  type Col = { campo: string; titulo: string; numerica: boolean; tiempo: boolean };
  let cols: Col[];
  if (series.length) {
    cols = [
      ...(chart.x
        ? [{ campo: chart.x, titulo: chart.x.replace(/_/g, " "), numerica: false, tiempo: Boolean(chart.x_es_tiempo) }]
        : []),
      ...series.map((s) => ({
        campo: s.campo,
        titulo: s.unidad ? `${s.nombre} (${s.unidad})` : s.nombre,
        numerica: true,
        tiempo: false,
      })),
    ];
  } else {
    const claves = Array.from(new Set(datos.slice(0, 50).flatMap((d) => Object.keys(d))));
    cols = claves.map((c) => ({
      campo: c,
      titulo: c.replace(/_/g, " "),
      numerica: datos.some((d) => typeof d[c] === "number"),
      tiempo: c === chart.x && Boolean(chart.x_es_tiempo),
    }));
  }

  if (!datos.length) {
    return <div className="rounded-lg bg-sunk p-6 text-center text-sm text-ink-3">Sin filas</div>;
  }

  const filas = datos.slice(0, MAX_FILAS);

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="scroll-thin overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-[13.5px]">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.campo}
                  className={`border-b border-line px-3 py-2 align-bottom text-[12px] leading-tight font-semibold uppercase tracking-wide text-ink-3 first-letter:uppercase ${
                    c.numerica ? "text-right" : "text-left"
                  }`}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="odd:bg-surface even:bg-surface-2/60 hover:bg-accent-soft/50">
                {cols.map((c) => {
                  const v = f[c.campo];
                  const vacio = v === null || v === undefined || v === "";
                  return (
                    <td
                      key={c.campo}
                      className={`whitespace-nowrap border-b border-line/70 px-3 py-1.5 ${
                        c.numerica ? "text-right tabular" : "text-left"
                      } ${vacio ? "text-ink-3" : "text-ink"}`}
                    >
                      {vacio ? "—" : c.tiempo ? fmtTiempoCompacto(v) : c.numerica ? fmtNum(v) : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {datos.length > MAX_FILAS ? (
        <div className="border-t border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-3">
          Mostrando {MAX_FILAS} de {fmtNum(datos.length, 0)} filas
        </div>
      ) : null}
    </div>
  );
}
