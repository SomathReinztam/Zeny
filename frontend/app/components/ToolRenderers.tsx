"use client";

// Render de las tool calls del backend dentro del chat.
//
// Usamos `useRenderTool` de "@copilotkit/react-core/v2": registra un renderer
// (solo visual, no ejecuta nada en el frontend) para una tool que ejecuta el
// backend. El chat de @copilotkit/react-ui resuelve cada toolCall de los
// mensajes del asistente contra `copilotkit.renderToolCalls` (que incluye los
// renderers registrados por hook) y nos entrega:
//   status: "inProgress" (args llegando) | "executing" | "complete"
//   parameters: args parseados (parciales mientras llegan)
//   result: contenido del mensaje `tool` cuando la tool terminó.
// El renderer "*" es el comodín para cualquier otra tool (chip discreto).

import { useEffect, useState } from "react";
import { z } from "zod";
import { useRenderTool } from "@copilotkit/react-core/v2";
import { useEsPasoDeSubagente, useSubagenteDeTask } from "../lib/useWorkLog";
import { SubagenteRegistro } from "./WorkLog";
import { IconCheck, IconChevron, IconSearch, IconTool } from "./icons";

const taskArgs = z.object({
  description: z.string().optional(),
  subagent_type: z.string().optional(),
});

type Estado = "inProgress" | "executing" | "complete";

function useCronometro(activo: boolean) {
  const [inicio] = useState(() => Date.now());
  const [ahora, setAhora] = useState(inicio);
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return Math.max(0, Math.round((ahora - inicio) / 1000));
}

function textoResultado(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") {
    try {
      const j = JSON.parse(result);
      if (typeof j === "string") return j;
      if (j && typeof j === "object" && "content" in j && typeof j.content === "string") return j.content;
      return JSON.stringify(j, null, 2);
    } catch {
      return result;
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function TaskCard({
  status,
  descripcion,
  subagente,
  result,
  toolCallId,
}: {
  status: Estado;
  descripcion?: string;
  subagente?: string;
  result?: unknown;
  toolCallId?: string;
}) {
  const listo = status === "complete";
  const seg = useCronometro(!listo);
  const [abierto, setAbierto] = useState(false);
  const nombre = subagente || "subagente";
  const texto = listo ? textoResultado(result) : "";
  // Registro de trabajo en vivo de este subagente (razonamiento + pasos SQL).
  const sub = useSubagenteDeTask(toolCallId);

  return (
    <div
      className={`my-1.5 overflow-hidden rounded-xl border bg-surface transition-colors ${
        listo ? "border-line" : "border-accent/50 shadow-[0_0_0_3px_var(--accent-ring)]"
      }`}
    >
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        <span
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
            listo ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent-ink"
          }`}
        >
          {listo ? <IconCheck size={15} strokeWidth={3} /> : <IconSearch size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <span className="truncate">
              {listo ? `${nombre} terminó` : `🔎 ${nombre} trabajando…`}
            </span>
            {!listo ? (
              <>
                <span className="spinner spinner-sm" />
                <span className="ml-auto shrink-0 text-[11.5px] font-medium tabular text-ink-3">{seg} s</span>
              </>
            ) : null}
          </div>
          {descripcion ? (
            <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-ink-2">{descripcion}</p>
          ) : (
            <div className="skeleton mt-1.5 h-3 w-3/4 rounded" />
          )}
          {/* Registro en vivo mientras el subagente trabaja. */}
          {!listo && sub ? <SubagenteRegistro sub={sub} /> : null}
          {/* Terminado: deja el registro plegado como traza. */}
          {listo && sub ? <SubagenteRegistro sub={sub} compacto /> : null}
        </div>
      </div>
      {listo && texto ? (
        <>
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex w-full items-center gap-1.5 border-t border-line bg-surface-2 px-3.5 py-1.5 text-left text-[12.5px] font-medium text-ink-2 hover:bg-sunk"
            aria-expanded={abierto}
          >
            <IconChevron
              size={14}
              style={{ transform: abierto ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
            />
            {abierto ? "Ocultar resultado" : "Ver resultado"}
          </button>
          {abierto ? (
            <div className="scroll-thin max-h-64 overflow-auto border-t border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
              {texto}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ToolChip({ name, status }: { name: string; status: Estado }) {
  const listo = status === "complete";
  return (
    <span className="my-0.5 mr-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-medium text-ink-3">
      {listo ? <IconTool size={11} /> : <span className="spinner spinner-sm" />}
      {name}
    </span>
  );
}

// Tools que NO se pintan como chip en el chat principal:
//  - write_todos: el plan ya se ve en el estado.
//  - ejecutar_sql: es de un subagente; se muestra dentro de su TaskCard.
const OCULTAS = new Set(["write_todos", "ejecutar_sql"]);

// Chip comodín: se oculta si la tool pertenece a un subagente (ya va en su
// tarjeta) o está en la lista de ocultas.
function ToolChipComodin({
  name,
  status,
  toolCallId,
}: {
  name: string;
  status: Estado;
  toolCallId?: string;
}) {
  const esDeSub = useEsPasoDeSubagente(toolCallId);
  if (OCULTAS.has(name) || esDeSub) return null;
  return <ToolChip name={name} status={status} />;
}

export function ToolRenderers() {
  useRenderTool(
    {
      name: "task",
      parameters: taskArgs,
      render: ({ status, parameters, result, toolCallId }) => (
        <TaskCard
          status={status}
          descripcion={parameters?.description}
          subagente={parameters?.subagent_type}
          result={result}
          toolCallId={toolCallId}
        />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "write_todos",
      parameters: z.object({}).passthrough(),
      render: () => null,
    },
    [],
  );

  useRenderTool(
    {
      name: "*",
      render: ({
        name,
        status,
        toolCallId,
      }: {
        name: string;
        status: Estado;
        toolCallId?: string;
      }) => <ToolChipComodin name={name} status={status} toolCallId={toolCallId} />,
    },
    [],
  );

  return null;
}
