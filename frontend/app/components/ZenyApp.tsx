"use client";

import Image from "next/image";
import { useCallback, useEffect } from "react";
import type { Message } from "@ag-ui/client";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-ui";
import { DEMO_MESSAGES, DEMO_STATE, DEMO_WORKLOG } from "../fixtures";
import { useZenyCanvas } from "../lib/useZenyCanvas";
import { WorkLogProvider } from "../lib/useWorkLog";
import { Canvas, SUGERENCIAS } from "./Canvas";
import { Header, PlanStrip } from "./Header";
import { ToolRenderers } from "./ToolRenderers";
import { ZenyThinking } from "./WorkLog";

const SALUDO =
  "¡Hola! Soy **Zeny** ☀️, la asistente de datos de Zentrack.\n\n" +
  "Puedo revisar la generación, la radiación, los inversores y los 26 trackers de la minigranja **Joropo**. " +
  "Mientras investigo, iré dibujando las gráficas en el panel. ¿Qué quieres saber?";

// Evita lanzar dos veces la pregunta inicial (StrictMode monta efectos dos veces en dev).
const preguntasLanzadas = new Set<string>();

export function ZenyApp({ demo, preguntaInicial }: { demo: boolean; preguntaInicial?: string }) {
  const { agent, canvas, running } = useZenyCanvas();
  const { copilotkit } = useCopilotKit();

  // Modo demo: inyecta estado y conversación de ejemplo por el mismo camino que el backend.
  useEffect(() => {
    if (!demo || !agent) return;
    agent.setState(DEMO_STATE);
    const t = setTimeout(() => agent.setMessages(DEMO_MESSAGES as Message[]), 300);
    return () => clearTimeout(t);
  }, [demo, agent]);

  const preguntar = useCallback(
    async (texto: string) => {
      if (!agent || agent.isRunning) return;
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: texto });
      try {
        await copilotkit.runAgent({ agent });
      } catch (e) {
        console.error("Zeny: error al ejecutar el agente", e);
      }
    },
    [agent, copilotkit],
  );

  useEffect(() => {
    if (!preguntaInicial || demo || !agent || preguntasLanzadas.has(preguntaInicial)) return;
    const t = setTimeout(() => {
      if (preguntasLanzadas.has(preguntaInicial)) return;
      preguntasLanzadas.add(preguntaInicial);
      void preguntar(preguntaInicial);
    }, 500);
    return () => clearTimeout(t);
  }, [preguntaInicial, demo, agent, preguntar]);

  return (
    <WorkLogProvider demo={demo} demoSnapshot={DEMO_WORKLOG}>
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <ToolRenderers />
      <Header running={running} demo={demo} />

      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <main className="scroll-thin flex flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6 lg:px-7">
            <PlanStrip todos={canvas.todos} />
            <div className="flex-1">
              <Canvas canvas={canvas} running={running} onPreguntar={preguntar} />
            </div>
          </div>
        </main>

        <aside className="flex h-[80dvh] shrink-0 flex-col border-t border-line bg-surface lg:h-auto lg:w-[360px] lg:border-t-0 lg:border-l xl:w-[420px] 2xl:w-[460px]">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-accent-soft">
              <Image
                src="/brand/zeny-256.webp"
                alt=""
                width={256}
                height={295}
                className="absolute top-0.5 left-1/2 w-[38px] max-w-none -translate-x-1/2"
              />
            </div>
            <div className="min-w-0">
              <div className="font-display text-[16px] font-semibold leading-tight text-ink">Conversa con Zeny</div>
              <div className="text-[12px] text-ink-3">
                {running ? "Zeny y sus analistas están trabajando…" : "Pregunta en lenguaje natural"}
              </div>
            </div>
          </div>
          <div className="zeny-chat flex min-h-0 flex-1 flex-col">
            {/* Razonamiento de Zeny en vivo, encima del hilo del chat. */}
            <ZenyThinking />
            <div className="min-h-0 flex-1">
              <CopilotChat
                labels={{
                  initial: SALUDO,
                  placeholder: "Pregúntale algo a Zeny…",
                  error: "No pude conectarme con Zeny. ¿El backend está encendido?",
                  stopGenerating: "Detener",
                  regenerateResponse: "Regenerar respuesta",
                  copyToClipboard: "Copiar",
                  thumbsUp: "Me gusta",
                  thumbsDown: "No me gusta",
                  copied: "¡Copiado!",
                }}
                suggestions={SUGERENCIAS.map((s) => ({ title: s, message: s }))}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
    </WorkLogProvider>
  );
}
