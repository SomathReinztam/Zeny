// Estado de ejemplo para el modo demo (?demo=1): permite revisar el diseño sin backend.
// Datos sintéticos pero realistas de la minigranja Joropo (1034,9 kWp), septiembre 2026.

import type { WorkLog } from "./lib/useWorkLog";
import type { Chart, Fila, ZenyState } from "./lib/types";

// PRNG determinista (mulberry32) para que el demo sea siempre igual.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: number, h: number, mi = 0) =>
  `2026-09-${pad(d)}T${pad(h)}:${pad(mi)}:00`;
const round = (v: number, f = 1) => Math.round(v * 10 ** f) / 10 ** f;

const KWP = 1034.9;
const LIMITE_AC = 720; // kWh/h ≈ límite de inyección

// Nubosidad por día (1 = despejado).
const rand = rng(20260917);
const NUBES = Array.from({ length: 31 }, () => 0.62 + rand() * 0.36);
NUBES[11] = 0.45; // 12 sep muy nublado
NUBES[22] = 0.5;

function poa(dia: number, hora: number, r: () => number): number {
  if (hora < 6 || hora > 18) return 0;
  const base = Math.sin((Math.PI * (hora - 6)) / 12);
  if (base <= 0) return 0;
  const nube = NUBES[dia] * (0.85 + r() * 0.3);
  return Math.max(0, Math.min(1100, 1100 * Math.pow(base, 1.15) * nube));
}

function energia(p: number, r: () => number): number {
  if (p <= 0) return 0;
  return Math.min(LIMITE_AC, (p / 1000) * KWP * 0.72 * (0.96 + r() * 0.06));
}

// ---------------------------------------------------------------- horario 15–21 sep
const rh = rng(7);
const horario: Fila[] = [];
for (let d = 15; d <= 21; d++) {
  for (let h = 0; h < 24; h++) {
    const p = poa(d, h, rh);
    const e = energia(p, rh);
    // Hueco de datos el 18/09 entre 10:00 y 13:00 (caída de comunicaciones).
    const hueco = d === 18 && h >= 10 && h <= 13;
    horario.push({
      fecha_hora: iso(d, h),
      energia_kwh: hueco ? null : round(e, 1),
      poa_wm2: hueco ? null : round(p, 0),
    });
  }
}

// ---------------------------------------------------------------- diario por inversor
const rd = rng(42);
const diarioInv: Fila[] = [];
let energiaMes = 0;
for (let d = 1; d <= 30; d++) {
  let total = 0;
  for (let h = 6; h <= 18; h++) total += energia(poa(d, h, rd), rd);
  const fila: Fila = { fecha: iso(d, 0) };
  for (let i = 1; i <= 5; i++) {
    let v = (total / 5) * (0.97 + rd() * 0.06);
    if (i === 4 && (d === 9 || d === 10)) v = d === 9 ? v * 0.35 : 0; // INV-04 fuera de servicio
    fila[`inv${i}`] = round(v / 1000, 2);
    energiaMes += v;
  }
  diarioInv.push(fila);
}

// ---------------------------------------------------------------- dispersión energía vs POA
const rs = rng(99);
const dispersion: Fila[] = [];
for (let d = 1; d <= 30; d++) {
  for (let h = 6; h <= 18; h++) {
    const p = poa(d, h, rs);
    if (p < 20) continue;
    let e = energia(p, rs);
    if (rs() < 0.04) e *= 0.45 + rs() * 0.3; // eventos de bajo rendimiento
    dispersion.push({ poa_wm2: round(p, 0), energia_kwh: round(e, 1) });
  }
}

// ---------------------------------------------------------------- trackers (2 días, cada 2 min)
const rt = rng(5);
const trackers: Fila[] = [];
for (let d = 17; d <= 18; d++) {
  for (let m = 0; m < 24 * 60; m += 2) {
    const h = m / 60;
    let consigna = 0;
    if (h >= 6 && h <= 18) {
      // Seguimiento de eje único: de -50° (mañana) a +50° (tarde), con backtracking en los extremos.
      const ang = ((h - 12) / 6) * 60;
      consigna = Math.max(-50, Math.min(50, ang));
      if (h < 6.6 || h > 17.4) consigna *= (Math.min(h - 6, 18 - h) / 0.6) || 0;
    }
    const t07 = consigna + (rt() - 0.5) * 1.2;
    let t19: number | null = consigna + (rt() - 0.5) * 1.5;
    if (d === 18 && h >= 10.5) t19 = 12 + (rt() - 0.5) * 0.4; // atascado
    if (d === 17 && h >= 14 && h < 14.5) t19 = null; // sin dato
    trackers.push({
      fecha_hora: iso(d, Math.floor(h), m % 60),
      consigna: round(consigna, 1),
      trk07: round(t07, 1),
      trk19: t19 === null ? null : round(t19, 1),
    });
  }
}

// Energía total sintética del mes (referencia; el KPI usa el valor oficial de 162,4 MWh).
export const ENERGIA_SINTETICA_MWH = round(energiaMes / 1000, 1);

const ahora = "2026-10-16T09:30:00-05:00";

// ---------------------------------------------------------------- mapa de calor energía hora×día
const rhc = rng(321);
const mapaCalor: Fila[] = [];
for (let d = 1; d <= 30; d++) {
  const falla = d === 18 || d === 23 || d === 24; // días con parada / sin exportación
  for (let h = 0; h < 24; h++) {
    let v = 0;
    if (!falla && h >= 6 && h <= 18) {
      const base = Math.sin((Math.PI * (h - 6)) / 12);
      v = Math.max(0, Math.min(700, 700 * Math.pow(base, 1.1) * NUBES[d] * (0.9 + rhc() * 0.2)));
    }
    mapaCalor.push({ dia: `2026-09-${pad(d)}`, hora: `${pad(h)}:00`, kwh: round(v, 1) });
  }
}

// ---------------------------------------------------------------- calendario de PR diario
const rcal = rng(654);
const calendarioPr: Fila[] = [];
for (let d = 1; d <= 30; d++) {
  let pr: number;
  if (d === 23 || d === 24) pr = 0; // sin exportación
  else if (d === 18) pr = 0.07; // parada parcial
  else if (d === 27) pr = 0.42; // día muy nublado
  else pr = 0.74 + rcal() * 0.14;
  calendarioPr.push({ fecha: `2026-09-${pad(d)}`, pr: round(Math.min(0.9, pr), 2) });
}

// ---------------------------------------------------------------- dona: estado de la flota de trackers
const donaFlota: Fila[] = [
  { estado: "Normal", cantidad: 20 },
  { estado: "Con falla", cantidad: 2 },
  { estado: "Sin datos", cantidad: 4 },
];

// ---------------------------------------------------------------- banda de temperatura del panel por hora
const rb = rng(88);
const bandaTemp: Fila[] = [];
for (let h = 0; h < 24; h++) {
  const sol = h >= 6 && h <= 18 ? Math.sin((Math.PI * (h - 6)) / 12) : 0;
  const prom = 22 + sol * 30; // ~22 °C de noche → ~52 °C al mediodía
  const amp = 2 + sol * 7;
  bandaTemp.push({
    hora: iso(15, h),
    t_min: round(prom - amp - rb() * 1.5, 1),
    t_prom: round(prom, 1),
    t_max: round(prom + amp + rb() * 1.5, 1),
  });
}

const charts: Chart[] = [
  {
    id: "kpi-septiembre",
    titulo: "Resumen de septiembre 2026",
    subtitulo: "Minigranja Joropo · 1034,9 kWp",
    tipo: "kpi",
    kpis: [
      { etiqueta: "Energía generada", valor: 162.4, unidad: "MWh", estado: "ok", detalle: "+4 % vs agosto" },
      { etiqueta: "Performance Ratio", valor: 0.78, estado: "alerta", detalle: "Meta ≥ 0,80" },
      { etiqueta: "Rendimiento específico", valor: round((162.4 * 1000) / KWP, 0), unidad: "kWh/kWp", estado: "ok" },
      { etiqueta: "Disponibilidad de datos", valor: 68, unidad: "%", estado: "critico", detalle: "Estación meteo con huecos" },
      { etiqueta: "Trackers con falla", valor: "2 / 26", estado: "alerta", detalle: "Tracker 11 y Tracker 20" },
    ],
    insight:
      "La planta generó cerca de 162 MWh en septiembre, en línea con lo esperado, pero el PR de 0,78 queda bajo la meta. La principal causa es la falta de datos de la estación meteorológica y dos trackers con fallas.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT date_trunc('month', ts) AS mes,\n       sum(energia_kwh) / 1000 AS energia_mwh,\n       sum(energia_kwh) / (1034.9 * sum(poa_wh_m2) / 1000) AS pr\nFROM medidor_frontera m\nJOIN estacion_meteo e USING (ts)\nWHERE ts >= '2026-09-01' AND ts < '2026-10-01'\nGROUP BY 1;",
  },
  {
    id: "mapa-calor-energia",
    titulo: "Energía exportada por hora y día",
    subtitulo: "Septiembre 2026 · kWh exportados al medidor de frontera",
    tipo: "mapa_calor",
    x: "dia",
    y: "hora",
    valor: "kwh",
    unidad: "kWh",
    datos: mapaCalor,
    insight:
      "El patrón solar es claro: producción entre las 6:00 y las 18:00 con pico sostenido de 11:00 a 13:00 (hasta ~700 kWh/h). Resaltan tres columnas casi vacías: el 18, el 23 y el 24 de septiembre apenas exportaron energía.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT to_char(hora AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS dia,\n       to_char(hora AT TIME ZONE 'America/Bogota', 'HH24:00') AS hora,\n       round(COALESCE(kwh_frontera, 0)::numeric, 1) AS kwh\nFROM analitica.v_energia_horaria\nWHERE hora >= '2026-09-01' AND hora < '2026-10-01'\nORDER BY hora;",
  },
  {
    id: "calendario-pr",
    titulo: "Performance Ratio diario",
    subtitulo: "Septiembre 2026 · PR por día (0 a 1)",
    tipo: "calendario",
    x: "fecha",
    valor: "pr",
    datos: calendarioPr,
    insight:
      "La mayoría de los días el PR ronda 0,80, pero el 23 y 24 caen a cero (sin exportación) y el 18 queda muy bajo por una parada. El 27, muy nublado, baja a 0,42. Son los días a investigar.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT to_char(dia, 'YYYY-MM-DD') AS fecha,\n       round((kwh_frontera / NULLIF(1034.9 * poa_kwh_m2, 0))::numeric, 2) AS pr\nFROM analitica.v_energia_diaria\nWHERE dia >= '2026-09-01' AND dia < '2026-10-01'\nORDER BY dia;",
  },
  {
    id: "dona-flota",
    titulo: "Estado de la flota de trackers",
    subtitulo: "26 trackers · estado al cierre de septiembre",
    tipo: "dona",
    x: "estado",
    valor: "cantidad",
    datos: donaFlota,
    insight:
      "De los 26 trackers, 20 operan con normalidad. Dos presentan falla confirmada (Tracker 11 y Tracker 20) y cuatro no están enviando datos, por lo que su estado real se desconoce: conviene revisar la comunicación de esos seis equipos.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT estado, count(*) AS cantidad\nFROM analitica.v_tracker_estado_diario\nWHERE dia = '2026-09-30'\nGROUP BY estado\nORDER BY cantidad DESC;",
  },
  {
    id: "medidor-pr",
    titulo: "Performance Ratio del mes",
    subtitulo: "Septiembre 2026 · meta ≥ 0,80",
    tipo: "medidor",
    valor: 0.76,
    maximo: 1,
    unidad: "",
    insight:
      "El PR del mes cerró en 0,76, por debajo de la meta de 0,80. La brecha se explica sobre todo por los días sin exportación (23 y 24) y por los huecos de datos de la estación meteorológica.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT round((sum(kwh_frontera) / NULLIF(1034.9 * sum(poa_kwh_m2), 0))::numeric, 2) AS pr\nFROM analitica.v_energia_diaria\nWHERE dia >= '2026-09-01' AND dia < '2026-10-01';",
  },
  {
    id: "banda-temperatura",
    titulo: "Temperatura del panel por hora",
    subtitulo: "15 de septiembre · mínimo, promedio y máximo",
    tipo: "banda",
    x: "hora",
    x_es_tiempo: true,
    series: [
      { campo: "t_min", nombre: "Mínimo", unidad: "°C" },
      { campo: "t_prom", nombre: "Promedio", unidad: "°C" },
      { campo: "t_max", nombre: "Máximo", unidad: "°C" },
    ],
    datos: bandaTemp,
    insight:
      "La temperatura del panel sigue el ciclo solar: de ~22 °C en la madrugada a picos cercanos a 60 °C al mediodía. La banda se ensancha en las horas centrales, cuando la radiación y el viento hacen variar más la temperatura entre módulos.",
    severidad: "info",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT date_trunc('hour', ts) AS hora,\n       min(temp_panel) AS t_min,\n       avg(temp_panel) AS t_prom,\n       max(temp_panel) AS t_max\nFROM sensores_modulo\nWHERE ts >= '2026-09-15' AND ts < '2026-09-16'\nGROUP BY 1 ORDER BY 1;",
  },
  {
    id: "energia-vs-poa",
    titulo: "Energía horaria vs radiación solar",
    subtitulo: "15 al 21 de septiembre · medidor de frontera y estación meteorológica",
    tipo: "linea",
    x: "fecha_hora",
    x_es_tiempo: true,
    series: [
      { campo: "energia_kwh", nombre: "Energía", unidad: "kWh", eje: "izq" },
      { campo: "poa_wm2", nombre: "Radiación POA", unidad: "W/m²", eje: "der" },
    ],
    datos: horario,
    insight:
      "La energía sigue muy de cerca a la radiación: la planta responde bien al sol. Los picos se aplanan cerca de 720 kWh/h por el límite de inyección. El 18/09 entre 10:00 y 13:00 no hay datos (caída de comunicaciones).",
    severidad: "info",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT date_trunc('hour', m.ts) AS fecha_hora,\n       sum(m.energia_kwh) AS energia_kwh,\n       avg(e.poa_wm2) AS poa_wm2\nFROM medidor_frontera m\nLEFT JOIN estacion_meteo e ON e.ts = m.ts\nWHERE m.ts BETWEEN '2026-09-15' AND '2026-09-22'\nGROUP BY 1 ORDER BY 1;",
  },
  {
    id: "energia-diaria-inversor",
    titulo: "Energía diaria por inversor",
    subtitulo: "Septiembre 2026 · 5 inversores Huawei",
    tipo: "barras_apiladas",
    x: "fecha",
    x_es_tiempo: true,
    series: [1, 2, 3, 4, 5].map((i) => ({ campo: `inv${i}`, nombre: `INV-0${i}`, unidad: "MWh" })),
    datos: diarioInv,
    insight:
      "Los cinco inversores aportan por igual casi todo el mes. El INV-04 estuvo fuera de servicio el 9 y 10 de septiembre: se perdieron aproximadamente 1,3 MWh.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT ts::date AS fecha, inversor, sum(energia_kwh)/1000 AS mwh\nFROM inversores\nWHERE ts >= '2026-09-01' AND ts < '2026-10-01'\nGROUP BY 1, 2;",
  },
  {
    id: "trackers-angulo",
    titulo: "Ángulo de los trackers",
    subtitulo: "17 y 18 de septiembre · datos cada 2 minutos",
    tipo: "linea",
    x: "fecha_hora",
    x_es_tiempo: true,
    series: [
      { campo: "consigna", nombre: "Consigna", unidad: "°" },
      { campo: "trk07", nombre: "Tracker 1", unidad: "°" },
      { campo: "trk19", nombre: "Tracker 20", unidad: "°" },
    ],
    datos: trackers,
    insight:
      "El Tracker 20 quedó atascado cerca de 0° (horizontal) y dejó de seguir al sol. Se estima una pérdida del 15 % en su fila durante la tarde. Conviene revisar el motor y el controlador.",
    severidad: "critico",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT ts AS fecha_hora, consigna_deg AS consigna,\n       max(pitch_deg) FILTER (WHERE tracker='Tracker 1') AS trk07,\n       max(pitch_deg) FILTER (WHERE tracker='Tracker 20') AS trk19\nFROM trackers\nWHERE ts BETWEEN '2026-09-17' AND '2026-09-19'\nGROUP BY 1, 2 ORDER BY 1;",
  },
  {
    id: "dispersion-poa",
    titulo: "Energía vs radiación (cada hora)",
    subtitulo: "Septiembre 2026 · un punto por hora de sol",
    tipo: "dispersion",
    x: "poa_wm2",
    series: [{ campo: "energia_kwh", nombre: "Energía horaria", unidad: "kWh" }],
    datos: dispersion,
    insight:
      "Casi todos los puntos forman una línea recta: buena señal. Los puntos que caen por debajo son horas con bajo rendimiento, que coinciden con las fallas de trackers.",
    severidad: "info",
    autor: "analista-sql",
    creado_en: ahora,
    sql: "SELECT avg(e.poa_wm2) AS poa_wm2, sum(m.energia_kwh) AS energia_kwh\nFROM medidor_frontera m JOIN estacion_meteo e USING (ts)\nGROUP BY date_trunc('hour', ts);",
  },
  {
    id: "disponibilidad",
    titulo: "Disponibilidad de datos por equipo",
    subtitulo: "% de registros recibidos en septiembre",
    tipo: "barras",
    x: "equipo",
    series: [{ campo: "disponibilidad", nombre: "Disponibilidad", unidad: "%" }],
    datos: [
      { equipo: "Medidor", disponibilidad: 97.2 },
      { equipo: "Inversores", disponibilidad: 93.5 },
      { equipo: "Trackers", disponibilidad: 71.8 },
      { equipo: "Estación meteo", disponibilidad: 41.3 },
    ],
    insight:
      "La estación meteorológica solo envió el 41 % de sus datos. Sin ella no se puede calcular bien el PR: es lo primero que hay que arreglar.",
    severidad: "critico",
    autor: "analista-sql",
    creado_en: ahora,
  },
  {
    id: "tabla-trackers",
    titulo: "Trackers con desviación",
    subtitulo: "Desviación media respecto a la consigna > 5°",
    tipo: "tabla",
    x: "tracker",
    series: [
      { campo: "desviacion", nombre: "Desviación media", unidad: "°" },
      { campo: "horas", nombre: "Horas afectadas", unidad: "h" },
      { campo: "perdida", nombre: "Pérdida estimada", unidad: "kWh" },
    ],
    datos: [
      { tracker: "Tracker 20", desviacion: 27.4, horas: 61, perdida: 812 },
      { tracker: "Tracker 11", desviacion: 9.8, horas: 22, perdida: 164 },
      { tracker: "Tracker 2", desviacion: 5.6, horas: 4, perdida: null },
    ],
    insight: "Dos trackers concentran casi toda la pérdida por seguimiento. Tracker 2 tuvo una desviación corta y sin impacto medible.",
    severidad: "alerta",
    autor: "analista-sql",
    creado_en: ahora,
  },
];

export const DEMO_STATE: ZenyState = {
  // Orden de llegada: la primera del objeto es la más antigua (queda abajo en el lienzo).
  charts: Object.fromEntries([...charts].reverse().map((c) => [c.id, c])),
  todos: [
    { content: "Revisar energía y PR del mes", status: "completed" },
    { content: "Comparar energía con radiación solar", status: "completed" },
    { content: "Analizar los 26 trackers", status: "completed" },
    { content: "Evaluar calidad de datos de la estación", status: "in_progress" },
    { content: "Redactar conclusiones", status: "pending" },
  ],
};

// Conversación de ejemplo para ver las tarjetas `task` en el chat.
export const DEMO_MESSAGES = [
  { id: "demo-u1", role: "user" as const, content: "¿Cómo le fue a la planta en septiembre?" },
  {
    id: "demo-a1",
    role: "assistant" as const,
    content: "",
    toolCalls: [
      {
        id: "demo-tc1",
        type: "function" as const,
        function: {
          name: "task",
          arguments: JSON.stringify({
            subagent_type: "analista-sql",
            description: "Calcular energía mensual, PR y rendimiento específico de septiembre 2026.",
          }),
        },
      },
      {
        id: "demo-tc2",
        type: "function" as const,
        function: {
          name: "task",
          arguments: JSON.stringify({
            subagent_type: "analista-sql",
            description: "Revisar el ángulo de los 26 trackers frente a la consigna y detectar atascos.",
          }),
        },
      },
      {
        id: "demo-tc3",
        type: "function" as const,
        function: {
          name: "task",
          arguments: JSON.stringify({
            subagent_type: "analista-sql",
            description: "Medir la disponibilidad de datos de la estación meteorológica.",
          }),
        },
      },
    ],
  },
  {
    id: "demo-t1",
    role: "tool" as const,
    toolCallId: "demo-tc1",
    content:
      "Energía de septiembre: 162,4 MWh. PR: 0,78 (meta 0,80). Rendimiento específico: 157 kWh/kWp. Creé la gráfica «Resumen de septiembre 2026».",
  },
  {
    id: "demo-t2",
    role: "tool" as const,
    toolCallId: "demo-tc2",
    content:
      "Tracker 20 atascado cerca de 0°. Tracker 11 con desviación media alta. Creé «Ángulo de los trackers» y «Trackers con desviación».",
  },
];

// ---------------------------------------------------------------- WorkLog demo
// Registro de "modo trabajo en vivo" para ?demo=1: razonamiento de Zeny, un
// subagente EN CURSO (con razonamiento + pasos SQL, el último ejecutándose) y
// otro TERMINADO. Derivado de docs/ejemplo_stream_agui.sse.
export const DEMO_WORKLOG: WorkLog = {
  turno: 1,
  zenyPensando: true,
  zenyInicio: Date.now() - 7000,
  zenyRazonamiento:
    "**Revisando la estación meteorológica**\n\nTengo la energía del mes y el PR, pero el PR de 0,78 me hace dudar de los datos de radiación. " +
    "Antes de concluir, quiero medir cuántos registros envió realmente la estación meteo en septiembre: si faltan datos de POA, el PR queda mal calculado. " +
    "Le pido al analista que cruce los timestamps esperados contra los recibidos y me devuelva el porcentaje de disponibilidad por equipo.",
  porToolCall: {
    "demo-tc1": "sub-done",
    "demo-tc3": "sub-live",
  },
  subagentes: {
    "sub-done": {
      runId: "sub-done",
      nombre: "analista-sql",
      parentToolCallId: "demo-tc1",
      terminado: true,
      pensando: false,
      razonamiento:
        "**Energía y PR de septiembre**\n\nSumo la energía del medidor de frontera y la radiación POA de la estación para el mes completo. " +
        "Calculo el PR como energía real sobre energía teórica (POA × kWp). El resultado da 0,78, por debajo de la meta de 0,80.",
      sqlPendiente: [],
      pasos: [
        {
          toolCallId: "d1",
          nombre: "ejecutar_sql",
          sql: "SELECT sum(energia_kwh)/1000 AS mwh, sum(poa_wm2) AS poa FROM medidor_frontera m JOIN estacion_meteo e USING (ts) WHERE ts …",
          sqlFull:
            "SELECT sum(energia_kwh) / 1000 AS mwh,\n       sum(poa_wm2)         AS poa\nFROM medidor_frontera m\nJOIN estacion_meteo e USING (ts)\nWHERE ts >= '2026-09-01' AND ts < '2026-10-01';",
          argsRaw: "",
          resultado: "1 filas:\nmwh | poa\n162.4 | 148320",
          resumen: "1 fila",
          estado: "listo",
        },
        {
          toolCallId: "d2",
          nombre: "ejecutar_sql",
          sql: "SELECT ts::date AS dia, sum(energia_kwh)/1000 AS mwh FROM medidor_frontera WHERE ts >= '2026-09-01' AND ts < '2026-10-01' GROUP BY 1 ORDER BY 1",
          argsRaw: "",
          resultado: "30 filas:\ndia | mwh\n2026-09-01 | 5.8\n2026-09-02 | 6.1\n…",
          resumen: "30 filas",
          estado: "listo",
        },
      ],
    },
    "sub-live": {
      runId: "sub-live",
      nombre: "analista-sql",
      parentToolCallId: "demo-tc3",
      terminado: false,
      pensando: true,
      razonamiento:
        "**Midiendo la disponibilidad de datos**\n\nPara septiembre espero un registro cada 5 minutos por equipo (8 640 por mes). " +
        "Cuento los recibidos y los divido por los esperados. La estación meteo se ve muy incompleta: apenas supera el 40 %, lo que explica el PR bajo. " +
        "Ahora reviso si la caída se concentra en días puntuales o es constante a lo largo del mes…",
      sqlPendiente: [],
      pasos: [
        {
          toolCallId: "l1",
          nombre: "ejecutar_sql",
          sql: "SELECT equipo, count(*) AS recibidos, 8640 AS esperados, round(100.0*count(*)/8640,1) AS disp FROM lecturas WHERE ts >= '2026-09-01' AND ts < '2026-10-01' GROUP BY equipo ORDER BY disp",
          argsRaw: "",
          resultado:
            "4 filas:\nequipo | recibidos | esperados | disp\nEstación meteo | 3568 | 8640 | 41.3\nTrackers | 6205 | 8640 | 71.8\nInversores | 8078 | 8640 | 93.5\nMedidor | 8399 | 8640 | 97.2",
          resumen: "4 filas",
          estado: "listo",
        },
        {
          toolCallId: "l2",
          nombre: "ejecutar_sql",
          sql: "SELECT ts::date AS dia, round(100.0*count(*)/288,1) AS disp FROM lecturas WHERE equipo='Estación meteo' AND ts >= '2026-09-01' AND ts < '2026-10-01' GROUP BY 1 ORDER BY 1",
          argsRaw: "",
          resultado: "30 filas:\ndia | disp\n2026-09-01 | 12.5\n2026-09-02 | 0.0\n…",
          resumen: "30 filas",
          estado: "listo",
        },
        {
          toolCallId: "l3",
          nombre: "ejecutar_sql",
          sql: "SELECT extract(hour FROM ts) AS hora, round(100.0*count(*)/900,1) AS disp FROM lecturas WHERE equipo='Estación meteo' GROUP BY 1 …",
          sqlFull:
            "SELECT extract(hour FROM ts) AS hora,\n       round(100.0 * count(*) / 900, 1) AS disp\nFROM lecturas\nWHERE equipo = 'Estación meteo'\nGROUP BY 1\nORDER BY 1;",
          argsRaw: "",
          resultado: "",
          resumen: "",
          estado: "ejecutando",
        },
      ],
    },
  },
};
