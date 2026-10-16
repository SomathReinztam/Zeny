"use client";

// UI del "modo trabajo en vivo": razonamiento de Zeny y registro de los
// subagentes. Todo recortado (altura máx. + scroll/fade; SQL a 1-2 líneas;
// resultados a una línea). Respeta los tokens de globals.css; razonamiento en
// ink-3 atenuado, SQL monoespaciado.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PasoSql, SubagenteLog } from "../lib/useWorkLog";
import { useWorkLog } from "../lib/useWorkLog";
import { IconChevron } from "./icons";

// Segundos vivos mientras `activo`; útil para el cronómetro de "pensando".
function useSegundosVivos(activo: boolean, desde?: number) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(id);
  }, [activo]);
  if (desde == null) return 0;
  return Math.max(0, Math.round((ahora - desde) / 1000));
}

// Formato mínimo: resalta **negritas** y respeta saltos de línea. El texto de
// razonamiento ya viene recortado por altura, así que no hace falta sanear más.
function Formateado({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-ink-2">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Razonamiento atenuado con altura máxima, scroll fino y auto-scroll al final. */
function RazonamientoView({
  texto,
  pensando,
  maxH = 150,
}: {
  texto: string;
  pensando: boolean;
  maxH?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Mientras llegan tokens, mantener el scroll pegado abajo.
  useLayoutEffect(() => {
    if (pensando && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [texto, pensando]);
  return (
    <div className="relative">
      <div
        ref={ref}
        className="scroll-thin overflow-y-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-3"
        style={{
          maxHeight: maxH,
          maskImage: "linear-gradient(180deg,#000 82%,transparent)",
          WebkitMaskImage: "linear-gradient(180deg,#000 82%,transparent)",
        }}
      >
        <Formateado texto={texto} />
        {pensando ? <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-accent/70" /> : null}
      </div>
    </div>
  );
}

const CIRCULOS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/** Una línea de paso SQL: muestra la consulta recortada y permite expandirla. */
function PasoLinea({ paso, indice }: { paso: PasoSql; indice: number }) {
  const [expandido, setExpandido] = useState(false);
  const esError = paso.estado === "error";
  const corriendo = paso.estado === "ejecutando";
  const compacto = paso.sqlFull ? paso.sqlFull.replace(/\s+/g, " ").trim() : "";
  const baseLen = paso.sql.replace(/…\s*$/, "").length;
  const hayMas = Boolean(paso.sqlFull) && (compacto.length > baseLen || Boolean(paso.sqlFull?.includes("\n")));
  return (
    <li className="text-[12px] leading-snug">
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 tabular text-ink-3">{CIRCULOS[indice] ?? `${indice + 1}.`}</span>
        <span className="min-w-0 flex-1">
          <span className="mr-1 font-semibold text-ink-3">SQL →</span>
          {paso.sql ? (
            hayMas ? (
              <button
                type="button"
                onClick={() => setExpandido((v) => !v)}
                className="text-left font-mono text-[11px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                aria-expanded={expandido}
                title={expandido ? "Ocultar consulta" : "Ver consulta completa"}
              >
                {expandido ? "ocultar consulta" : paso.sql}
              </button>
            ) : (
              <span className="font-mono text-[11px] text-ink-2">{paso.sql}</span>
            )
          ) : (
            <span className="text-ink-3 italic">{corriendo ? "preparando consulta…" : "(consulta)"}</span>
          )}
          {expandido && paso.sqlFull ? (
            <pre className="scroll-thin mt-1 max-h-40 overflow-auto rounded-md bg-[#1a1a1a] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[#f2f2f2]">
              {paso.sqlFull}
            </pre>
          ) : null}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-[18px]">
        {corriendo ? (
          <>
            <span className="spinner spinner-sm" />
            <span className="text-[11px] text-ink-3">ejecutando…</span>
          </>
        ) : (
          <span className={`text-[11px] font-medium ${esError ? "text-crit" : "text-ok"}`}>
            ← {paso.resumen || (esError ? "error" : "ok")}
          </span>
        )}
      </div>
    </li>
  );
}

/** Registro de trabajo de un subagente: su razonamiento y sus pasos de SQL. */
export function SubagenteRegistro({
  sub,
  compacto,
}: {
  sub: SubagenteLog;
  compacto?: boolean; // true = subagente terminado → colapsado por defecto
}) {
  const [abierto, setAbierto] = useState(!compacto);
  const [verRazon, setVerRazon] = useState(!compacto);
  const tienePasos = sub.pasos.length > 0;
  const tieneRazon = sub.razonamiento.trim().length > 0;
  if (!tienePasos && !tieneRazon) return null;

  const cuerpo = (
    <div className="space-y-2">
      {tieneRazon ? (
        <div>
          <button
            type="button"
            onClick={() => setVerRazon((v) => !v)}
            className="flex items-center gap-1 text-[11.5px] font-medium text-ink-3 hover:text-ink-2"
            aria-expanded={verRazon}
          >
            <IconChevron
              size={12}
              style={{ transform: verRazon ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
            />
            {sub.pensando ? "Razonando…" : "Razonamiento"}
          </button>
          {verRazon ? (
            <div className="mt-1 border-l-2 border-line pl-2.5">
              <RazonamientoView texto={sub.razonamiento} pensando={sub.pensando} maxH={120} />
            </div>
          ) : null}
        </div>
      ) : null}

      {tienePasos ? (
        <ol className="space-y-1.5">
          {sub.pasos.map((p, i) => (
            <PasoLinea key={p.toolCallId} paso={p} indice={i} />
          ))}
        </ol>
      ) : null}
    </div>
  );

  // Terminado → colapsable discreto; en curso → siempre visible.
  if (compacto) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="flex items-center gap-1 text-[11.5px] font-medium text-ink-3 hover:text-ink-2"
          aria-expanded={abierto}
        >
          <IconChevron
            size={12}
            style={{ transform: abierto ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
          />
          Registro de trabajo ({sub.pasos.length} consulta{sub.pasos.length === 1 ? "" : "s"})
        </button>
        {abierto ? <div className="mt-1.5">{cuerpo}</div> : null}
      </div>
    );
  }
  return <div className="mt-2 border-t border-dashed border-line pt-2">{cuerpo}</div>;
}

/** Bloque "Zeny está pensando…" para el panel de chat. */
export function ZenyThinking() {
  const wl = useWorkLog();
  const [expandido, setExpandido] = useState(false);
  const pensando = wl.zenyPensando;
  const tiene = pensando || wl.zenyRazonamiento.trim().length > 0;
  const segVivos = useSegundosVivos(pensando, wl.zenyInicio);
  const segFinal =
    wl.zenyInicio != null && wl.zenyFin != null
      ? Math.max(0, Math.round((wl.zenyFin - wl.zenyInicio) / 1000))
      : 0;

  if (!tiene) return null;

  if (pensando) {
    return (
      <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-accent/40 bg-accent-soft/40 shadow-[0_0_0_3px_var(--accent-ring)]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-semibold text-ink">
          <span>💭</span>
          <span>Zeny está pensando…</span>
          <span className="spinner spinner-sm" />
          <span className="ml-auto tabular text-[11.5px] font-medium text-ink-3">{segVivos} s</span>
        </div>
        <div className="border-t border-accent/20 px-3 py-2">
          <RazonamientoView texto={wl.zenyRazonamiento} pensando maxH={140} />
        </div>
      </div>
    );
  }

  // Terminó de pensar: colapsado a "Pensó durante Xs".
  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-line bg-surface-2">
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] font-medium text-ink-2 hover:bg-sunk"
        aria-expanded={expandido}
      >
        <span>💭</span>
        <span>{segFinal < 1 ? "Pensó un momento" : `Pensó durante ${segFinal} s`}</span>
        <IconChevron
          size={13}
          className="ml-auto text-ink-3"
          style={{ transform: expandido ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
        />
      </button>
      {expandido ? (
        <div className="border-t border-line px-3 py-2">
          <RazonamientoView texto={wl.zenyRazonamiento} pensando={false} maxH={220} />
        </div>
      ) : null}
    </div>
  );
}
