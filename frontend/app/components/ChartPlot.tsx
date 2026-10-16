"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { Chart, Serie } from "../lib/types";
import {
  fmtEje,
  fmtLargo,
  fmtNum,
  fmtTiempoCompacto,
  parseWallClock,
  ticksTiempo,
  toNumberOrNull,
} from "../lib/format";

export const COLORES = [
  "var(--s1)",
  "var(--s2)",
  "var(--s3)",
  "var(--s4)",
  "var(--s5)",
  "var(--s6)",
];
export const colorSerie = (i: number) => COLORES[i % COLORES.length];

// =====================================================================
//  Escala secuencial de marca (claro → naranja intenso). Valores altos
//  = más intensos. Usada por mapa_calor y calendario.
// =====================================================================
const RAMPA_SEC = ["#fff4de", "#fde3b0", "#fdc466", "#fd9c10", "#dd7c0a", "#9a5600"];
function hexRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const RGB_SEC = RAMPA_SEC.map(hexRgb);
/** t∈[0,1] → color de la rampa secuencial. */
function colorSecuencial(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RGB_SEC.length - 1);
  const i = Math.min(RGB_SEC.length - 2, Math.floor(x));
  const f = x - i;
  const a = RGB_SEC[i];
  const b = RGB_SEC[i + 1];
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
const GRAD_SEC = `linear-gradient(90deg, ${RAMPA_SEC.join(", ")})`;
const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Barra de leyenda min–max para escalas secuenciales. */
function LeyendaSecuencial({ min, max, unidad }: { min: number; max: number; unidad?: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 px-1 text-[11px] text-ink-3">
      <span className="tabular">{fmtNum(min)}</span>
      <span className="h-2.5 flex-1 rounded-full" style={{ background: GRAD_SEC }} aria-hidden />
      <span className="tabular">
        {fmtNum(max)}
        {unidad ? ` ${unidad}` : ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------- tooltip flotante (celdas)
type Tip = { left: number; top: number; w: number; node: ReactNode };

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const mover = useCallback((e: { clientX: number; clientY: number }, node: ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ left: e.clientX - r.left, top: e.clientY - r.top, w: r.width, node });
  }, []);
  const salir = useCallback(() => setTip(null), []);
  return { ref, tip, mover, salir };
}

function TipFlotante({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const left = Math.max(74, Math.min(tip.w - 74, tip.left));
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]"
      style={{ left, top: tip.top - 12, transform: "translate(-50%, -100%)" }}
    >
      {tip.node}
    </div>
  );
}

const colEtiqueta = "font-semibold text-ink-2";

// =====================================================================
//  mapa_calor — rejilla día (x) × hora (y) coloreada por `valor`.
// =====================================================================
function MapaCalor({ chart, height }: { chart: Chart; height: number }) {
  const xCampo = chart.x ?? "x";
  const yCampo = chart.y ?? "y";
  const vCampo = typeof chart.valor === "string" ? chart.valor : "valor";
  const unidad = chart.unidad;
  const datos = useMemo(() => chart.datos ?? [], [chart.datos]);
  const { ref, tip, mover, salir } = useTip();

  const { xs, ys, mapa, min, max } = useMemo(() => {
    const xset = new Set<string>();
    const yset = new Set<string>();
    const mapa = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    for (const d of datos) {
      const xv = d[xCampo] == null ? "" : String(d[xCampo]);
      const yv = d[yCampo] == null ? "" : String(d[yCampo]);
      if (!xv || !yv) continue;
      xset.add(xv);
      yset.add(yv);
      const v = toNumberOrNull(d[vCampo]);
      if (v == null) continue;
      mapa.set(xv + "|" + yv, v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const xs = [...xset].sort(
      (a, b) => ((parseWallClock(a) ?? 0) - (parseWallClock(b) ?? 0)) || (a < b ? -1 : a > b ? 1 : 0),
    );
    const horaNum = (s: string) => {
      const m = /(\d+)/.exec(s);
      return m ? +m[1] : 0;
    };
    const ys = [...yset].sort((a, b) => horaNum(a) - horaNum(b));
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const piso = Math.min(0, min);
    return { xs, ys, mapa, min: piso, max: max > piso ? max : piso + 1 };
  }, [datos, xCampo, yCampo, vCampo]);

  const diaDe = (s: string) => {
    const t = parseWallClock(s);
    return t == null ? s : String(new Date(t).getUTCDate());
  };
  const horaDe = (s: string) => {
    const m = /(\d+)/.exec(s);
    return m ? m[1].padStart(2, "0") : s;
  };

  const celdaH = Math.max(12, Math.min(28, Math.floor((height - 26) / Math.max(1, ys.length))));
  const span = max - min || 1;

  const celdas = useMemo(() => {
    const out: ReactNode[] = [];
    // Esquina + cabecera de días.
    out.push(<div key="corner" />);
    for (const xv of xs) {
      out.push(
        <div key={"h-" + xv} className="text-center text-[9px] leading-none text-ink-3 tabular">
          {diaDe(xv)}
        </div>,
      );
    }
    for (const yv of ys) {
      out.push(
        <div
          key={"y-" + yv}
          className="pr-1 text-right text-[9.5px] leading-none text-ink-3 tabular"
          style={{ alignSelf: "center" }}
        >
          {horaDe(yv)}
        </div>,
      );
      for (const xv of xs) {
        const v = mapa.get(xv + "|" + yv);
        const vacio = v === undefined;
        const bg = vacio ? "var(--surface-sunk)" : colorSecuencial((v - min) / span);
        out.push(
          <div
            key={xv + "|" + yv}
            className="rounded-[2px]"
            style={{ height: celdaH, background: bg }}
            onMouseMove={
              vacio
                ? undefined
                : (e) =>
                    mover(
                      e,
                      <div className="flex flex-col gap-0.5">
                        <div className={colEtiqueta}>{parseWallClock(xv) != null ? fmtLargo(parseWallClock(xv)!) : xv}</div>
                        <div className="text-ink-3">
                          {horaDe(yv)}:00 h ·{" "}
                          <span className="font-semibold tabular text-ink">
                            {fmtNum(v)}
                            {unidad ? ` ${unidad}` : ""}
                          </span>
                        </div>
                      </div>,
                    )
            }
          />,
        );
      }
    }
    return out;
  }, [xs, ys, mapa, min, span, celdaH, unidad, mover]);

  if (xs.length === 0 || ys.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg bg-sunk text-sm text-ink-3">
        Sin datos para graficar
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} className="relative" onMouseLeave={salir}>
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `26px repeat(${xs.length}, minmax(6px, 1fr))` }}
        >
          {celdas}
        </div>
        <TipFlotante tip={tip} />
      </div>
      <LeyendaSecuencial min={min} max={max} unidad={unidad} />
    </div>
  );
}

// =====================================================================
//  calendario — cuadrícula mensual tipo GitHub, día coloreado por `valor`.
// =====================================================================
const DIAS_LETRA = ["L", "M", "X", "J", "V", "S", "D"];

function Calendario({ chart }: { chart: Chart }) {
  const xCampo = chart.x ?? "fecha";
  const vCampo = typeof chart.valor === "string" ? chart.valor : "valor";
  const unidad = chart.unidad;
  const datos = useMemo(() => chart.datos ?? [], [chart.datos]);
  const { ref, tip, mover, salir } = useTip();

  const info = useMemo(() => {
    const porDia = new Map<number, number>();
    let min = Infinity;
    let max = -Infinity;
    let anio = 0;
    let mes = -1;
    for (const d of datos) {
      const t = parseWallClock(d[xCampo]);
      if (t == null) continue;
      const dt = new Date(t);
      if (mes < 0) {
        anio = dt.getUTCFullYear();
        mes = dt.getUTCMonth();
      }
      const v = toNumberOrNull(d[vCampo]);
      porDia.set(dt.getUTCDate(), v == null ? NaN : v);
      if (v != null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const piso = Math.min(0, min);
    return { porDia, min: piso, max: max > piso ? max : piso + 1, anio, mes };
  }, [datos, xCampo, vCampo]);

  if (info.mes < 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg bg-sunk text-sm text-ink-3">
        Sin datos para graficar
      </div>
    );
  }

  const { porDia, min, max, anio, mes } = info;
  const span = max - min || 1;
  const diasEnMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const primerDiaSem = (new Date(Date.UTC(anio, mes, 1)).getUTCDay() + 6) % 7; // L=0
  const celdas: ReactNode[] = [];
  for (let i = 0; i < primerDiaSem; i++) celdas.push(<div key={"b" + i} />);
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const raw = porDia.get(dia);
    const tiene = raw !== undefined && Number.isFinite(raw);
    const v = tiene ? (raw as number) : null;
    const t = tiene ? (v! - min) / span : 0;
    const bg = tiene ? colorSecuencial(t) : "var(--surface-sunk)";
    const claro = !tiene || t < 0.52;
    celdas.push(
      <div
        key={dia}
        className="relative aspect-square rounded-md"
        style={{ background: bg }}
        onMouseMove={(e) =>
          mover(
            e,
            <div className="flex flex-col gap-0.5">
              <div className={colEtiqueta}>{fmtLargo(Date.UTC(anio, mes, dia))}</div>
              <div className="text-ink-3">
                {v == null ? (
                  <span className="italic">sin dato</span>
                ) : (
                  <span className="font-semibold tabular text-ink">
                    {fmtNum(v)}
                    {unidad ? ` ${unidad}` : ""}
                  </span>
                )}
              </div>
            </div>,
          )
        }
      >
        <span
          className="absolute top-1 left-1.5 text-[10px] leading-none tabular"
          style={{ color: claro ? "var(--ink-3)" : "rgba(255,255,255,0.92)" }}
        >
          {dia}
        </span>
      </div>,
    );
  }

  return (
    <div>
      <div className="mb-2 px-1 text-[12.5px] font-semibold text-ink-2">
        {MESES_LARGO[mes]} {anio}
      </div>
      <div className="mx-auto max-w-[360px]">
        <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold text-ink-3">
          {DIAS_LETRA.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>
        <div ref={ref} className="relative" onMouseLeave={salir}>
          <div className="grid grid-cols-7 gap-1.5">{celdas}</div>
          <TipFlotante tip={tip} />
        </div>
      </div>
      <LeyendaSecuencial min={min} max={max} unidad={unidad} />
    </div>
  );
}

// =====================================================================
//  dona — anillo con porcentajes y total al centro.
// =====================================================================
type DonaItem = { nombre: string; valor: number };

function DonaTooltip({ total, active, payload }: { total: number; active?: boolean; payload?: ReadonlyArray<PayloadItem> }) {
  if (!active || !payload || payload.length === 0) return null;
  const it = payload[0];
  const v = typeof it.value === "number" ? it.value : Number(it.value);
  const pct = total > 0 ? (v / total) * 100 : 0;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
        <span className="text-ink-2">{String(it.name ?? "")}</span>
        <span className="ml-auto pl-4 font-semibold tabular text-ink">{fmtNum(v)}</span>
      </div>
      <div className="mt-0.5 text-right text-[11px] text-ink-3 tabular">{fmtNum(pct, 1)} %</div>
    </div>
  );
}

function Dona({ chart, height }: { chart: Chart; height: number }) {
  const xCampo = chart.x ?? "x";
  const vCampo = typeof chart.valor === "string" ? chart.valor : "valor";
  const items: DonaItem[] = useMemo(() => {
    return (chart.datos ?? [])
      .map((d) => ({ nombre: d[xCampo] == null ? "" : String(d[xCampo]), valor: toNumberOrNull(d[vCampo]) ?? 0 }))
      .filter((i) => i.valor > 0);
  }, [chart.datos, xCampo, vCampo]);
  const total = items.reduce((s, i) => s + i.valor, 0);

  if (items.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg bg-sunk text-sm text-ink-3">
        Sin datos para graficar
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              isAnimationActive={false}
              content={(p) => (
                <DonaTooltip total={total} active={p.active} payload={p.payload as ReadonlyArray<PayloadItem> | undefined} />
              )}
            />
            <Pie
              data={items}
              dataKey="valor"
              nameKey="nombre"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={items.length > 1 ? 2 : 0}
              stroke="var(--surface)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {items.map((_, i) => (
                <Cell key={i} fill={colorSerie(i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[1.7rem] font-semibold leading-none tabular text-ink">{fmtNum(total)}</span>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">total</span>
        </div>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {items.map((it, i) => {
          const pct = total > 0 ? (it.valor / total) * 100 : 0;
          return (
            <li key={it.nombre + i} className="flex items-center gap-2 text-[13px]">
              <span className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={{ background: colorSerie(i) }} />
              <span className="min-w-0 truncate text-ink-2">{it.nombre}</span>
              <span className="ml-auto pl-3 font-semibold tabular text-ink">{fmtNum(it.valor)}</span>
              <span className="w-12 pl-1 text-right text-[11.5px] tabular text-ink-3">{fmtNum(pct, 1)} %</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =====================================================================
//  medidor — arco semicircular (gauge) de 0 a `maximo`.
// =====================================================================
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}
function arco(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function Medidor({ chart, height }: { chart: Chart; height: number }) {
  const valor = toNumberOrNull(chart.valor) ?? 0;
  const unidad = chart.unidad ?? "";
  let maximo = chart.maximo;
  if (maximo == null || !(maximo > 0)) {
    maximo = valor <= 1 ? 1 : valor <= 100 ? 100 : Math.pow(10, Math.ceil(Math.log10(valor || 1)));
  }
  const sev = chart.severidad ?? "info";
  const color = sev === "critico" ? "var(--crit)" : sev === "alerta" ? "var(--warn)" : "var(--accent)";
  const f = Math.max(0, Math.min(1, valor / maximo));
  const ang = 180 - 180 * f;

  const W = 260;
  const cx = W / 2;
  const cy = 148;
  const R = 108;
  const grosor = 20;
  const [nx, ny] = polar(cx, cy, R - grosor / 2, ang);
  const decimales = maximo <= 1 ? 2 : undefined;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full" style={{ maxWidth: W }}>
        <svg viewBox={`0 0 ${W} 172`} width="100%" height={Math.min(height, 220)} role="img">
          <path d={arco(cx, cy, R, 180, 0)} fill="none" stroke="var(--surface-sunk)" strokeWidth={grosor} strokeLinecap="round" />
          <path d={arco(cx, cy, R, 180, ang)} fill="none" stroke={color} strokeWidth={grosor} strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={3.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke={color} strokeWidth={3} />
          <text x={polar(cx, cy, R, 180)[0]} y={cy + 16} textAnchor="middle" className="tabular" fontSize="11" fill="var(--ink-3)">
            {fmtNum(0)}
          </text>
          <text x={polar(cx, cy, R, 0)[0]} y={cy + 16} textAnchor="middle" className="tabular" fontSize="11" fill="var(--ink-3)">
            {fmtNum(maximo, decimales)}
          </text>
        </svg>
        <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: cy - 56 }}>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-[2.6rem] font-semibold leading-none tabular" style={{ color }}>
              {fmtNum(valor, decimales)}
            </span>
            {unidad ? <span className="text-base font-medium text-ink-3">{unidad}</span> : null}
          </div>
          <span className="mt-1 text-[11.5px] text-ink-3 tabular">de {fmtNum(maximo, decimales)}{unidad ? ` ${unidad}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
//  banda — área sombreada entre series[0] y series[2] + línea series[1].
// =====================================================================
const BANDA = "__banda";

function BandaTooltip({
  active,
  payload,
  series,
  etiquetaX,
}: {
  active?: boolean;
  payload?: ReadonlyArray<PayloadItem>;
  series: Serie[];
  etiquetaX: (v: unknown) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const fila = payload[0]?.payload;
  const xVal = fila?.[T];
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
      <div className="mb-1 font-medium text-ink-2">{etiquetaX(xVal)}</div>
      <div className="flex flex-col gap-0.5">
        {series.map((s, i) => {
          const raw = fila?.[s.campo];
          return (
            <div key={s.campo} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: i === 1 ? colorSerie(0) : "var(--line-strong)" }}
              />
              <span className="text-ink-2">{s.nombre}</span>
              <span className="ml-auto pl-4 font-semibold tabular text-ink">
                {raw === null || raw === undefined ? (
                  <span className="font-normal text-ink-3">sin dato</span>
                ) : (
                  <>
                    {fmtNum(raw)}
                    {s.unidad ? <span className="ml-0.5 font-normal text-ink-3"> {s.unidad}</span> : null}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Banda({ chart, height }: { chart: Chart; height: number }) {
  const series = useMemo(() => chart.series ?? [], [chart.series]);
  const xCampo = chart.x;
  const xEsTiempo = Boolean(chart.x_es_tiempo);
  const sMin = series[0];
  const sMid = series[1];
  const sMax = series[2];

  const filas = useMemo(() => {
    const datos = chart.datos ?? [];
    return datos.map((d) => {
      const f: Fila = { ...d };
      for (const s of series) f[s.campo] = toNumberOrNull(d[s.campo]);
      if (xEsTiempo && xCampo) f[T] = parseWallClock(d[xCampo]);
      const lo = sMin ? f[sMin.campo] : null;
      const hi = sMax ? f[sMax.campo] : null;
      f[BANDA] = typeof lo === "number" && typeof hi === "number" ? ([lo, hi] as unknown as number) : (null as unknown as number);
      return f;
    });
  }, [chart.datos, series, xEsTiempo, xCampo, sMin, sMax]);

  const tiempo = useMemo(() => {
    if (!xEsTiempo) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const f of filas) {
      const t = f[T];
      if (typeof t === "number") {
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    if (!Number.isFinite(min)) return null;
    return { min, max, ...ticksTiempo(min, max, 6) };
  }, [filas, xEsTiempo]);

  const etiquetaX = (v: unknown): string => {
    if (xEsTiempo) {
      const t = parseWallClock(v);
      return t == null ? String(v ?? "") : fmtLargo(t);
    }
    return String(v ?? "");
  };

  if (filas.length === 0 || series.length < 3) {
    return (
      <div className="grid h-40 place-items-center rounded-lg bg-sunk text-sm text-ink-3">
        Sin datos para graficar
      </div>
    );
  }

  const hayDer = series.some((s) => s.eje === "der");
  const ejeMid = sMid?.eje === "der" ? "der" : "izq";
  const xKey = xEsTiempo ? T : xCampo;

  return (
    <div>
      <UnidadesEje series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={filas} margin={{ top: 4, right: hayDer ? 0 : 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey={xKey}
            type={xEsTiempo ? "number" : "category"}
            domain={tiempo ? [tiempo.min, tiempo.max] : undefined}
            ticks={tiempo?.ticks}
            tickFormatter={(v) => (tiempo ? tiempo.fmt(v) : xEsTiempo ? fmtTiempoCompacto(v) : String(v))}
            tick={tickStyle}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={16}
            interval={xEsTiempo ? 0 : "preserveStartEnd"}
          />
          <YAxis yAxisId="izq" tick={tickStyle} tickLine={false} axisLine={false} tickFormatter={fmtEje} width={52} />
          {hayDer ? (
            <YAxis yAxisId="der" orientation="right" tick={tickStyle} tickLine={false} axisLine={false} tickFormatter={fmtEje} width={52} />
          ) : null}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
            content={(p) => (
              <BandaTooltip
                active={p.active}
                payload={p.payload as ReadonlyArray<PayloadItem> | undefined}
                series={series}
                etiquetaX={etiquetaX}
              />
            )}
          />
          <Area
            yAxisId="izq"
            type="monotone"
            dataKey={BANDA}
            name={`${sMin?.nombre ?? "mín"}–${sMax?.nombre ?? "máx"}`}
            stroke={colorSerie(0)}
            strokeOpacity={0.3}
            strokeWidth={1}
            fill={colorSerie(0)}
            fillOpacity={0.2}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
          />
          <Line
            yAxisId={ejeMid}
            type="monotone"
            dataKey={sMid?.campo}
            name={sMid?.nombre}
            stroke={colorSerie(0)}
            strokeWidth={2.4}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const ANIM_MAX_PUNTOS = 300;
const T = "__t";

type Fila = Record<string, number | string | null>;

type PayloadItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: unknown;
  color?: string;
  payload?: Fila;
};

function ZTooltip({
  active,
  payload,
  label,
  series,
  etiquetaX,
  xEsTiempo,
  xCampo,
}: {
  active?: boolean;
  payload?: ReadonlyArray<PayloadItem>;
  label?: unknown;
  series: Serie[];
  etiquetaX: (v: unknown) => string;
  xEsTiempo: boolean;
  xCampo?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const fila = payload[0]?.payload;
  const xVal = xEsTiempo ? fila?.[T] : xCampo ? fila?.[xCampo] : label;
  const porCampo = new Map(series.map((s, i) => [s.campo, { s, i }]));
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
      <div className="mb-1 font-medium text-ink-2">{etiquetaX(xVal ?? label)}</div>
      <div className="flex flex-col gap-0.5">
        {series.map((s, i) => {
          const item = payload.find((p) => p.dataKey === s.campo);
          const raw = item ? item.value : fila?.[s.campo];
          if (raw === undefined && !item) return null;
          const meta = porCampo.get(s.campo);
          return (
            <div key={s.campo} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colorSerie(meta?.i ?? i) }}
              />
              <span className="text-ink-2">{s.nombre}</span>
              <span className="ml-auto pl-4 font-semibold tabular text-ink">
                {raw === null || raw === undefined ? (
                  <span className="font-normal text-ink-3">sin dato</span>
                ) : (
                  <>
                    {fmtNum(raw)}
                    {s.unidad ? <span className="ml-0.5 font-normal text-ink-3"> {s.unidad}</span> : null}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnidadesEje({ series }: { series: Serie[] }) {
  const izq = series.filter((s) => s.eje !== "der");
  const der = series.filter((s) => s.eje === "der");
  const etiqueta = (ss: Serie[]) => Array.from(new Set(ss.map((s) => s.unidad).filter(Boolean))).join(" · ");
  const ei = etiqueta(izq);
  const ed = etiqueta(der);
  if (!ei && !ed) return null;
  return (
    <div className="mb-1 flex justify-between px-1 text-[11.5px] font-semibold tracking-wide text-ink-3">
      <span>{ei}</span>
      <span>{ed}</span>
    </div>
  );
}

const tickStyle = { fontSize: 12, fill: "var(--ink-3)" };

export function ChartPlot({ chart, height = 280 }: { chart: Chart; height?: number }) {
  // Despacho de tipos nuevos (2026-10-16): cada uno es un componente propio con
  // sus hooks; el render clásico (cartesianos/dispersión) queda intacto abajo.
  switch (chart.tipo) {
    case "mapa_calor":
      return <MapaCalor chart={chart} height={Math.max(height, 300)} />;
    case "calendario":
      return <Calendario chart={chart} />;
    case "dona":
      return <Dona chart={chart} height={Math.min(height, 240)} />;
    case "medidor":
      return <Medidor chart={chart} height={height} />;
    case "banda":
      return <Banda chart={chart} height={height} />;
    default:
      return <ChartPlotClasico chart={chart} height={height} />;
  }
}

function ChartPlotClasico({ chart, height = 280 }: { chart: Chart; height?: number }) {
  const series = useMemo(() => chart.series ?? [], [chart.series]);
  const xCampo = chart.x;
  const tipo = chart.tipo;
  const xEsTiempo = Boolean(chart.x_es_tiempo);
  const esBarras = tipo === "barras" || tipo === "barras_apiladas";
  // Barras usan eje de categorías; líneas/áreas/dispersión con tiempo usan eje numérico.
  const tiempoNumerico = xEsTiempo && !esBarras;

  const filas = useMemo(() => {
    const datos = chart.datos ?? [];
    return datos.map((d) => {
      const f: Fila = { ...d };
      for (const s of series) f[s.campo] = toNumberOrNull(d[s.campo]);
      if (tiempoNumerico && xCampo) f[T] = parseWallClock(d[xCampo]);
      else if (tipo === "dispersion" && xCampo) f[xCampo] = toNumberOrNull(d[xCampo]);
      return f;
    });
  }, [chart.datos, series, tiempoNumerico, xCampo, tipo]);

  const animar = filas.length <= ANIM_MAX_PUNTOS;
  const hayDer = series.some((s) => s.eje === "der");

  const tiempo = useMemo(() => {
    if (!tiempoNumerico) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const f of filas) {
      const t = f[T];
      if (typeof t === "number") {
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    if (!Number.isFinite(min)) return null;
    return { min, max, ...ticksTiempo(min, max, 6) };
  }, [filas, tiempoNumerico]);

  const etiquetaX = (v: unknown): string => {
    if (xEsTiempo) {
      const t = parseWallClock(v);
      return t == null ? String(v ?? "") : fmtLargo(t);
    }
    if (typeof v === "number") return fmtNum(v);
    return String(v ?? "");
  };

  if (filas.length === 0 || series.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg bg-sunk text-sm text-ink-3">
        Sin datos para graficar
      </div>
    );
  }

  const leyenda =
    series.length > 1 ? (
      <Legend
        verticalAlign="top"
        align="left"
        height={30}
        iconType="circle"
        iconSize={9}
        wrapperStyle={{ fontSize: 13, color: "var(--ink-2)", paddingLeft: 4 }}
      />
    ) : null;

  const tooltip = (
    <Tooltip
      isAnimationActive={false}
      cursor={esBarras ? { fill: "var(--surface-sunk)" } : { stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
      content={(p) => (
        <ZTooltip
          active={p.active}
          payload={p.payload as ReadonlyArray<PayloadItem> | undefined}
          label={p.label}
          series={series}
          etiquetaX={etiquetaX}
          xEsTiempo={tiempoNumerico}
          xCampo={xCampo}
        />
      )}
    />
  );

  // ---------------------------------------------------------------- dispersión
  if (tipo === "dispersion") {
    const xKey = tiempoNumerico ? T : xCampo ?? "x";
    return (
      <div>
        <UnidadesEje series={series} />
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis
              dataKey={xKey}
              type="number"
              domain={["auto", "auto"]}
              tick={tickStyle}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              ticks={tiempo?.ticks}
              tickFormatter={(v) => (tiempo ? tiempo.fmt(v) : fmtEje(v))}
              name={xCampo}
            />
            <YAxis
              yAxisId="izq"
              type="number"
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmtEje}
              width={52}
            />
            {hayDer ? (
              <YAxis
                yAxisId="der"
                orientation="right"
                type="number"
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtEje}
                width={52}
              />
            ) : null}
            <ZAxis range={[28, 28]} />
            {tooltip}
            {leyenda}
            {series.map((s, i) => (
              <Scatter
                key={s.campo}
                name={s.nombre}
                yAxisId={s.eje === "der" ? "der" : "izq"}
                data={filas.filter((f) => f[s.campo] !== null && f[xKey] !== null)}
                dataKey={s.campo}
                fill={colorSerie(i)}
                fillOpacity={0.55}
                isAnimationActive={animar}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ---------------------------------------------------------------- cartesianos
  const xKey = tiempoNumerico ? T : xCampo;

  // Sin dots (rendimiento), salvo puntos aislados entre huecos (null), que si no serían invisibles.
  const puntoAislado = (campo: string, color: string) =>
    function Punto(props: { cx?: number; cy?: number; index?: number }) {
      const { cx, cy, index = -1 } = props;
      const v = filas[index]?.[campo];
      const antes = filas[index - 1]?.[campo];
      const despues = filas[index + 1]?.[campo];
      const aislado = v !== null && v !== undefined && (antes == null) && (despues == null);
      if (!aislado || cx == null || cy == null) return <g key={`d-${campo}-${index}`} />;
      return <circle key={`d-${campo}-${index}`} cx={cx} cy={cy} r={3} fill={color} />;
    };
  const ultimaApilada = series.length - 1;

  return (
    <div>
      <UnidadesEje series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={filas}
          margin={{ top: 4, right: hayDer ? 0 : 12, bottom: 4, left: 0 }}
          barCategoryGap={filas.length > 20 ? "12%" : "24%"}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.campo} id={`grad-${chart.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorSerie(i)} stopOpacity={0.35} />
                <stop offset="100%" stopColor={colorSerie(i)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey={xKey}
            type={tiempoNumerico ? "number" : "category"}
            domain={tiempo ? [tiempo.min, tiempo.max] : undefined}
            ticks={tiempo?.ticks}
            tickFormatter={(v) =>
              tiempo ? tiempo.fmt(v) : xEsTiempo ? fmtTiempoCompacto(v) : String(v)
            }
            tick={tickStyle}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={16}
            interval={tiempoNumerico ? 0 : "preserveStartEnd"}
          />
          <YAxis
            yAxisId="izq"
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtEje}
            width={52}
          />
          {hayDer ? (
            <YAxis
              yAxisId="der"
              orientation="right"
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmtEje}
              width={52}
            />
          ) : null}
          {tooltip}
          {leyenda}
          {series.map((s, i) => {
            const eje = s.eje === "der" ? "der" : "izq";
            const color = colorSerie(i);
            if (tipo === "area") {
              return (
                <Area
                  key={s.campo}
                  yAxisId={eje}
                  type="monotone"
                  dataKey={s.campo}
                  name={s.nombre}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#grad-${chart.id}-${i})`}
                  dot={puntoAislado(s.campo, color)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                  connectNulls={false}
                  isAnimationActive={animar}
                />
              );
            }
            if (esBarras) {
              const apilada = tipo === "barras_apiladas";
              const r = apilada ? (i === ultimaApilada ? 4 : 0) : 4;
              return (
                <Bar
                  key={s.campo}
                  yAxisId={eje}
                  dataKey={s.campo}
                  name={s.nombre}
                  fill={color}
                  stackId={apilada ? "pila" : undefined}
                  radius={[r, r, 0, 0]}
                  maxBarSize={56}
                  stroke={apilada ? "var(--surface)" : undefined}
                  strokeWidth={apilada ? 1 : 0}
                  isAnimationActive={animar}
                />
              );
            }
            return (
              <Line
                key={s.campo}
                yAxisId={eje}
                type="monotone"
                dataKey={s.campo}
                name={s.nombre}
                stroke={color}
                strokeWidth={2}
                dot={puntoAislado(s.campo, color)}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                connectNulls={false}
                isAnimationActive={animar}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
