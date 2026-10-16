# Contrato backend ↔ frontend (AG-UI)

El frontend habla con el backend **solo por AG-UI**. Este documento define qué emite el backend y qué
renderiza el frontend. Si cambia, se cambia aquí primero.

## Conexión

| Clave | Valor |
|---|---|
| Endpoint AG-UI | `POST http://localhost:8100/agui` (env `NEXT_PUBLIC_AGUI_URL`) |
| Nombre del agente | `zeny` |
| Frontend (dev) | `http://localhost:3002` |

## Estado compartido (`STATE_SNAPSHOT`)

```ts
type ZenyState = {
  charts?: Record<string, Chart>;   // lienzo de gráficas; clave = chart.id
  todos?: Todo[];                   // plan de trabajo del agente (deepagents write_todos)
};

type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

type Chart = {
  id: string;
  titulo: string;
  subtitulo?: string;
  tipo: "linea" | "area" | "barras" | "barras_apiladas" | "dispersion" | "kpi" | "tabla";
  x?: string;                       // campo del eje X (no aplica a "kpi")
  x_es_tiempo?: boolean;            // si true, x es ISO local America/Bogota "2026-09-17T13:00:00"
  series?: Serie[];                 // campos numéricos a graficar (no aplica a "kpi")
  datos?: Record<string, number | string | null>[];   // ≤ 2000 filas; null = sin dato (NO es cero)
  kpis?: Kpi[];                     // solo para tipo "kpi"
  insight: string;                  // 1–3 frases: qué muestra y por qué importa
  severidad?: "info" | "alerta" | "critico";
  autor: string;                    // "zeny"
  creado_en: string;                // ISO
  sql?: string;                     // consulta que generó los datos (para "ver SQL")
};

type Serie = { campo: string; nombre: string; unidad?: string; eje?: "izq" | "der" };
type Kpi = {
  etiqueta: string; valor: number | string | null; unidad?: string;
  estado?: "ok" | "alerta" | "critico"; detalle?: string;
};
```

- Las gráficas aparecen **en cuanto Zeny las crea** (tool `crear_grafica` del agente principal; los subagentes solo investigan): el backend emite `STATE_SNAPSHOT` parciales
  (evento `manually_emit_state`) por cada gráfica, y al final del turno el estado real.
- Un `Chart` con la misma `id` reemplaza al anterior.

## Llamadas a herramientas que el frontend debe dibujar en el chat

| Tool | Args | Cómo dibujarla |
|---|---|---|
| `task` | `{ description: string, subagent_type: string }` | Tarjeta «🔎 {subagent_type} trabajando…» con la descripción; al terminar, ✓ y el resultado plegable. Varias en paralelo deben verse a la vez |
| `write_todos` | `{ todos: Todo[] }` | Opcional: no mostrar en el chat (el plan ya se ve desde el estado) |
| cualquier otra | — | Chip pequeño y discreto con el nombre de la tool |

---

# Streaming en vivo ("modo trabajo") — razonamiento y subagentes

Para la expo se muestra a Zeny y a los analistas trabajando: su **razonamiento**, sus **llamadas a
herramientas** y los **resultados recortados**. El backend ya emite estos eventos AG-UI (visibilidad de
subagentes = "attributed"). Hay un stream real capturado en `docs/ejemplo_stream_agui.sse` para pruebas
offline.

Todos los campos van en camelCase en el cable. **Cualquier** evento dentro de un turno puede traer
`subagentRunId`: si es `null` o falta, el evento es del agente principal (Zeny); si trae un id, es de ese
subagente.

## Eventos nuevos a consumir

| Evento | Campos relevantes | Uso |
|---|---|---|
| `REASONING_START` / `REASONING_END` | `subagentRunId?` | Abre/cierra un bloque de "pensando…". |
| `REASONING_MESSAGE_START/CONTENT/END` | `delta`, `subagentRunId?` | Tokens de razonamiento (van llegando). Mostrar en vivo, atenuado y colapsable. |
| `SUBAGENT_STARTED` | `subagentRunId`, `name`, `description`, `parentToolCallId`, `parentMessageId` | Empieza un subagente. `parentToolCallId` = el `toolCallId` de la tarjeta `task` a la que pertenece. |
| `SUBAGENT_FINISHED` | `subagentRunId`, `result` | Termina; `result` es su informe final (ya se muestra como resultado de `task`). |
| `TOOL_CALL_START` | `toolCallName`, `toolCallId`, `subagentRunId?` | p. ej. `ejecutar_sql` trae el `subagentRunId` del analista. |
| `TOOL_CALL_RESULT` | `content`/`result`, `subagentRunId?` | Resultado de la herramienta; recortar (ya hay `textoResultado`). |

## Enrutamiento

1. Mapa `parentToolCallId → subagentRunId` a partir de `SUBAGENT_STARTED`. La tarjeta `task` cuyo
   `toolCallId` coincide es la de ese subagente.
2. Todo evento con ese `subagentRunId` (razonamiento, `ejecutar_sql`, resultados) se pinta **dentro** de
   esa tarjeta como un "registro de trabajo" en vivo: líneas tipo `SQL → …` / `← N filas`, y el
   razonamiento atenuado y colapsable.
3. Los eventos sin `subagentRunId` son de Zeny: su razonamiento va como un bloque "Zeny está pensando…"
   colapsable en el chat; sus tool calls (`task`, `crear_grafica`, `write_todos`) siguen como hoy.
4. Al terminar (`SUBAGENT_FINISHED` / fin del turno), colapsar el registro y dejar el resumen (como hoy).

## Notas
- Recortar SIEMPRE: razonamiento con límite de altura y scroll o "ver más"; resultados de SQL a pocas
  líneas. El objetivo es que se vea actividad, no volcar texto.
- Con modelos de la EVO-X2 (GPU AMD ROCm) los tokens llegan lento (~4/s): el streaming es justo lo que
  deja ver que el agente avanza. Con Gemini llega rápido. La UI debe verse bien en ambos ritmos.
- El razonamiento de Gemini puede venir en inglés; el de Qwen3 en español. No traducirlo, es secundario.

---

# Tipos de gráfica nuevos (2026-10-16)

Se amplió `Chart.tipo`. Campos extra en `Chart` (todos opcionales, según el tipo):
`y?: string`, `valor?: string`, `maximo?: number`, `unidad?: string`.

| tipo | Campos que usa | Forma de `datos` / render |
|---|---|---|
| `mapa_calor` | `x` (día/fecha), `y` (categoría, p. ej. hora), `valor` (col numérica), `unidad?` | Una fila por celda `{[x], [y], [valor]}`. Rejilla x×y coloreada por `valor` (escala secuencial). `null` = celda vacía/sin dato. |
| `calendario` | `x` (fecha), `valor`, `unidad?` | Una fila por día `{[x], [valor]}`. Cuadrícula tipo calendario del mes, cada día coloreado por `valor`. |
| `dona` | `x` (categoría), `valor` | Una fila por categoría `{[x], [valor]}`. Anillo con porcentajes; leyenda con los nombres. |
| `medidor` | `valor` (number, ya resuelto), `maximo` (number), `unidad?` | Un solo número con aguja, de 0 a `maximo`. Colorear por `severidad`. No trae `datos`. |
| `banda` | `x` (tiempo), `series` = 3 en orden [mínimo, centro, máximo] | Como línea, pero área sombreada entre serie[0] y serie[2] y línea para serie[1]. |

Los tipos previos (`linea`, `area`, `barras`, `barras_apiladas`, `dispersion`, `kpi`, `tabla`) no cambian.

## Evento en vivo: SQL del analista (`CUSTOM name="zeny_sql"`)

Como el stream NO trae `TOOL_CALL_ARGS` con el texto del SQL, cada `ejecutar_sql` emite antes un evento
`CUSTOM` con `name: "zeny_sql"` y `value: { sql: "<consulta recortada a 600>" }`, etiquetado con el
`subagentRunId` del analista. El frontend lo usa para mostrar el texto del SQL en el paso de trabajo en
vivo (en vez de solo "N filas"). Si no llega, degradar al conteo de filas de `TOOL_CALL_RESULT`.
