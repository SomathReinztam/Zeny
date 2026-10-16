# Zeny v0 — Plan y arquitectura de la primera implementación (capa de datos)

**Fecha:** 2026-10-15 · **Objetivo inmediato:** prueba de concepto para presentar a colegas (2026-10-16).
**Alcance:** solo **datos**: carga de los reportes de la minigranja Joropo a Postgres, reglas fijas sobre esos
datos y un agente que consulta, supervisa y explica. **Fuera de alcance:** control real de equipos,
cámaras/YOLO, telemetría en vivo y envío de reportes sin conexión (ver §9, hoja de ruta).

---

> **Actualización 2026-10-16: cambio de foco.** Para la demo se prioriza la experiencia visual:
> el agente entiende los datos con subagentes SQL en paralelo y **dibuja gráficas en el frontend vía
> AG-UI** a medida que trabaja. Quedan para después: el motor de reglas (§6), el gate de acciones
> (§7.3), Grafana y la visión. Lo implementado está en §12.


## 1. Principio de diseño

> **El código calcula y vigila; el agente supervisa, explica y propone. El humano aprueba.**

| Capa | Quién la hace | Por qué |
|---|---|---|
| Ingesta y limpieza de datos | Python determinista (ETL) | Reproducible, testeable, sin alucinaciones |
| Detección de condiciones (umbrales, huecos, desalineación) | **Motor de reglas fijas** (Python + SQL) | Una regla de seguridad no puede depender de un LLM |
| Consulta flexible, correlación e interpretación | **Agente** (subagentes SQL en paralelo) | Preguntas abiertas que no se pueden prever |
| Acciones | Agente **propone** → humano **aprueba** → queda registrado | Trazabilidad; en v0 la acción es solo un registro |

El agente **lee** el estado de las reglas (tabla `operacion.alertas`), las prioriza, las cruza con otros datos
y las explica. No reemplaza a las reglas: las supervisa.

---

## 2. Arquitectura general

```mermaid
flowchart LR
    subgraph Fuentes["Fuentes (hoy: archivos)"]
        X["Reportes .xlsx<br/>Reportes-minigranja-Joropo/"]
        T["planta_joropo.toml<br/>(catálogo + umbrales)"]
    end

    subgraph Datos["Capa de datos (determinista)"]
        ETL["ETL<br/>xlsx → Postgres<br/>idempotente"]
        RG["Motor de reglas<br/>(cron / make reglas)"]
        PG[("Postgres 17 · zeny-db :5434<br/>planta · telemetria · analitica · operacion")]
    end

    subgraph Agente["Backend FastAPI · LangGraph deepagents"]
        Z["Zeny (agente principal)<br/>orquesta · explica · propone"]
        SQL1["subagente analista-sql"]
        SQL2["analista-sql (otra instancia,<br/>en paralelo)"]
        VIS["subagente inspector-visual<br/>(look_at_panel)"]
        GATE{{"Gate de aprobación<br/>(interrupt)"}}
    end

    subgraph UI["Tablets / navegador"]
        CK["Next.js + CopilotKit<br/>(chat + aprobación)"]
        GF["Grafana embebido (iframe)"]
    end

    LLM["vLLM en EVO-X2 :8000 (VPN)<br/>— o Gemini 3.5 Flash por env"]

    X --> ETL
    T --> ETL
    ETL --> PG
    T --> RG
    PG <--> RG
    RG -- "escribe alertas" --> PG

    CK -- "AG-UI (stream)" --> Z
    Z -- "task()" --> SQL1
    Z -- "task()" --> SQL2
    Z -- "task()" --> VIS
    SQL1 -- "SELECT (rol solo lectura)" --> PG
    SQL2 -- "SELECT" --> PG
    VIS -- "render PNG" --> GF
    Z -- "crear paneles (REST)" --> GF
    Z --> GATE -- "INSERT acción aprobada" --> PG
    GF -- "datasource" --> PG
    CK --- GF
    Z -.-> LLM
    SQL1 -.-> LLM
    VIS -.-> LLM
```

### Componentes y origen

| Componente | Origen | Cambios |
|---|---|---|
| Postgres 17 (`zeny-db`, puerto **5434**) | `../pgDataBase/docker-compose.yaml` (ya existe) | Ninguno. Luego, mover a `infra/` de este repo |
| Catálogo y umbrales | `../agente-zeny/planta_joropo.toml` | Copiar a `config/planta_joropo.toml` |
| Reglas de interpretación de datos | `../agente-zeny/AGENTS.md` §5 (ya validadas con los datos) | Se trasladan al ETL y a los prompts |
| Backend del agente, Grafana y frontend | `~/Documents/projects/AITinkeres` | Cambiar a deepagents, LLM configurable y prompts del dominio |

---

## 3. Reglas de interpretación de los datos (heredadas de `agente-zeny`)

Estas reglas se aplican **en el ETL**, no se le piden al modelo:

1. **Zona horaria:** todas las marcas son **hora local de Colombia (`America/Bogota`, UTC-5)**. La `Z` de
   algunos reportes es una etiqueta incorrecta del exportador: se descarta y se interpreta como hora local.
   Se guarda como `timestamptz`; la sesión del agente usa `SET TIME ZONE 'America/Bogota'`.
2. **«Suciedad (%)» es en realidad LIMPIEZA:** 100 % = paneles limpios. La columna se llama `limpieza_pct`.
3. **`-1` = lectura inválida → `NULL`**, *solo* en columnas de clima. En el pitch y en las magnitudes
   eléctricas de los trackers los negativos son legítimos.
4. **«Sin dato» ≠ cero.** Las celdas vacías son `NULL` y los huecos se reportan como problema de calidad.
5. **Inversores:** el archivo trae solo la energía **agregada** de los 5 inversores (no hay dato por equipo)
   y una fila `TOTAL` que se descarta.
6. **Tracker = TCU = controlador = seguidor.** Se nombran «Tracker N (MAC)». El catálogo tiene **26**;
   en los datos aparecen **22**. Los 4 sin datos se reportan, no se ignoran.

---

## 4. Modelo de datos (Postgres)

Cuatro esquemas, para que el subagente SQL entienda el propósito de cada tabla por su nombre:

| Esquema | Contenido | Quién escribe |
|---|---|---|
| `planta` | Catálogo de equipos y parámetros/umbrales | ETL (desde el `.toml`) |
| `telemetria` | Series de tiempo crudas, limpias | ETL |
| `analitica` | **Vistas** con métricas ya calculadas (horario, diario, calidad) | DDL (SQL fijo) |
| `operacion` | Alertas de las reglas y acciones propuestas/aprobadas | Motor de reglas y gate del agente |

### 4.1 Tablas

```text
planta.trackers          (tracker_id PK = MAC 'EFF378', numero, nombre)
planta.inversores        (inversor_id PK, nombre, modelo, potencia_nominal_kw)
planta.parametros        (clave PK, valor, unidad, descripcion)   -- umbrales del .toml

telemetria.tracker_posicion  (tracker_id FK, ts, pitch_deg)                       PK(tracker_id, ts)  ~15 min
telemetria.tracker_electrica (tracker_id FK, ts, i_bateria_a, i_panel_a,
                              v_bateria_v, v_panel_v)                             PK(tracker_id, ts)  ~15 min
telemetria.clima             (ts PK, viento_ms, viento_dir_deg, lluvia_mm, ghi_wm2,
                              poa_wm2, temp_ambiente_c, temp_panel_c,
                              limpieza_pct, v_bateria_estacion_v)                 ~1 min
telemetria.energia_inversores (ts PK, kwh)   -- agregado de los 5 inversores        1 h
telemetria.energia_frontera   (ts PK, kwh)   -- medidor de la subestación (Quoia)   15 min
telemetria.cargas            (id, archivo, sha256, filas, filas_descartadas, cargado_en)

operacion.alertas   (id, regla, severidad, equipo, ts_inicio, ts_fin, valor, umbral,
                     detalle jsonb, estado ['abierta','reconocida','cerrada'], creada_en)
operacion.acciones  (id, alerta_id FK NULL, accion, parametros jsonb, justificacion,
                     estado ['propuesta','aprobada','rechazada'], decidido_por, decidido_en)
```

### 4.2 Vistas de `analitica` (cálculo fijo, en SQL)

| Vista | Qué responde |
|---|---|
| `v_clima_horario` | Promedios horarios de clima; POA integrada en kWh/m² |
| `v_energia_horaria` | Inversores vs frontera vs POA por hora: **pérdida AC**, **PR de referencia** = E_frontera / (P_instalada × POA) |
| `v_energia_diaria` | Lo mismo por día, con la clasificación: normal / posible falla / causa climática / sin datos |
| `v_tracker_vs_flota` | Pitch de cada tracker vs la mediana de la flota en la misma ventana de 15 min |
| `v_tracker_estado_diario` | Por tracker y día: muestras, cobertura, batería mín./máx., horas inmóvil |
| `v_cobertura_datos` | Por fuente y día: muestras esperadas vs recibidas (calidad de datos) |

### 4.3 El diccionario de datos vive en la base

Cada tabla, columna y vista lleva un `COMMENT ON` con su significado, unidad y advertencias (p. ej.
`limpieza_pct`: «100 = limpio; el reporte la llama "Suciedad"»). El **prompt del subagente SQL se genera a
partir de esos comentarios** al arrancar el backend, así que la documentación y el esquema no se
desincronizan. A eso se suman unas **consultas de ejemplo** (few-shot) escritas a mano.

### 4.4 Seguridad del acceso del agente

- El rol `zeny_lector` tiene solo `SELECT` sobre `planta`, `telemetria`, `analitica` y `operacion`.
- `statement_timeout = 15s` en el rol; la tool limita los resultados (p. ej. 200 filas) y avisa si trunca.
- La única escritura del agente es `INSERT` en `operacion.acciones`, a través del gate y con un usuario
  distinto (`zeny_operador`).

---

## 5. ETL: `etl/cargar_xlsx.py`

```text
uv run python -m etl.cargar_xlsx --dir ../data/Reportes-minigranja-Joropo --toml config/planta_joropo.toml
```

1. Aplica el DDL (`db/schema.sql`, idempotente: `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE VIEW`).
2. Carga el catálogo y los parámetros desde el `.toml` (upsert).
3. Detecta el tipo de cada archivo **por sus columnas** (no por el nombre) y renombra a nombres canónicos.
4. Normaliza: zona horaria (§3.1), `-1` → `NULL` en clima, descarta la fila `TOTAL` y deduplica.
5. Valida: MAC presente en el catálogo, rangos físicos (pitch ∈ [-60, 60], kWh/h ≤ capacidad) y cuenta los descartes.
6. Inserta con `COPY` a una tabla temporal y luego `INSERT ... ON CONFLICT DO NOTHING`. Re-ejecutar no duplica.
7. Registra la carga en `telemetria.cargas` con el sha256 del archivo y lo omite si ya fue cargado.

`reporte_posicion` pesa 45 MB y tiene ~290k filas: leer con `openpyxl` en modo `read_only` o con `calamine`
(`pandas.read_excel(engine="calamine")`, mucho más rápido).

> El ETL de archivos es provisional. En la planta, el mismo esquema `telemetria` lo alimentará un colector
> (Modbus TCP / SunSpec / MQTT). Por eso el ETL escribe a las tablas y nada depende del formato xlsx.

---

## 6. Motor de reglas fijas: `reglas/`

Python puro. Cada regla es una función `(conexión, ventana, parámetros) -> list[Alerta]`, con sus
umbrales en `planta.parametros`. Se ejecuta con `make reglas` sobre todo septiembre; en la planta, por
cron cada 5–15 min. Es **idempotente**: una alerta abierta de la misma regla y equipo se extiende, no se duplica.

| ID | Regla | Umbral (fuente) | Estado del umbral |
|---|---|---|---|
| R1 | Viento fuerte y trackers fuera de la posición de defensa (0° ± 2°) | > 15 m/s (toml) | Del catálogo |
| R2 | Temperatura de módulo alta (pérdidas térmicas) | > 60 °C (toml) | Del catálogo |
| R3 | Limpieza baja → sugerir lavado | ⚠ por validar: el toml dice «pérdida > 5 %», pero la limpieza media es ~79 % | **Validar** |
| R4 | Tracker desalineado respecto a la flota con sol | > 10° vs mediana, POA ≥ 300 W/m² | agente-zeny, por validar |
| R5 | Tracker sin datos / inmóvil | > 2 h sin muestras o sin moverse con sol | Propuesto |
| R6 | Batería del controlador baja | < 23,5 V | agente-zeny, por validar |
| R7 | Energía baja con radiación normal (posible falla de planta) | rendimiento relativo < 0,6 | agente-zeny, por validar |
| R8 | Pérdida AC anómala (inversores vs frontera) | por definir | **Validar** |
| R9 | Sensor implausible (p. ej. temp. ambiente > temp. de panel con sol, o > 50 °C) | por definir | Propuesto |
| R10 | Huecos de datos por fuente | cobertura < 80 % en la hora | Propuesto |

---

## 7. Agente (deepagents)

### 7.1 Estructura

| Agente | Modelo (env) | Tools | Contexto |
|---|---|---|---|
| **Zeny** (principal) | `MODEL_MAIN` | `task` (deepagents), `write_todos`, tools de Grafana (leer/crear panel), `proponer_accion` (**con gate**) | Conceptos del dominio, principios de §1 y catálogo resumido. **No ve resultados SQL crudos** |
| **analista-sql** | `MODEL_SQL` | `listar_tablas`, `describir_tabla`, `ejecutar_sql` (solo lectura) | Diccionario de datos generado (§4.3) + few-shot. Devuelve **hallazgos y cifras**, no tablas enteras |
| **inspector-visual** | `MODEL_VISION` | `look_at_panel` (de AITinkeres) | Las imágenes viven solo aquí; devuelve un diagnóstico en texto |

**Paralelismo:** cuando Zeny emite varias llamadas `task(analista-sql, …)` en el mismo turno, deepagents
las ejecuta de forma concurrente (p. ej. «revisa trackers» y «revisa energía vs POA» a la vez). Requisitos:
- Que el modelo soporte varias *tool calls* por turno. En vLLM: `--enable-auto-tool-choice` y
  `--tool-call-parser` adecuado (Qwen → `hermes`). **Hay que verificarlo en la EVO-X2.**
- Que vLLM atienda peticiones concurrentes (lo hace con *continuous batching*), aunque cada una irá algo
  más lenta en una sola máquina.

### 7.2 ¿Se pierde la visión con deepagents? No.

deepagents se construye sobre `create_agent` de LangChain v1 (un grafo de LangGraph), así que:
- Una tool que devuelve `Command(update={"messages": [ToolMessage, HumanMessage(imagen)]})`, como
  `look_at_panel`, sigue funcionando igual.
- El `pre_model_hook` que limita las imágenes a 5 se reescribe como **middleware** (`wrap_model_call`
  o `before_model`). Es el mismo código con otra firma.
- **Mejor aún:** al poner la visión en un **subagente propio**, las imágenes nunca entran al contexto de
  Zeny y ese subagente puede usar un modelo con visión distinto al principal (Gemini mientras se arregla la
  visión de gemma-4-31B).

### 7.3 Gate de aprobación

deepagents trae `interrupt_on={"proponer_accion": True}`, pero su formato de interrupción
(`action_requests` / `decisions`) es distinto al que espera el frontend de AITinkeres
(`{kind: "approval_request"}` → `{approved}`). **Para v0 se reutiliza `gated_tool` de AITinkeres** (llama a
`interrupt()` dentro de la tool), que funciona igual dentro de deepagents y no requiere tocar el frontend.
Al aprobar, se inserta la fila en `operacion.acciones` con `estado='aprobada'`; en v0 **no se actúa sobre
hardware**.

### 7.4 Configuración del LLM (por variables de entorno)

```dotenv
LLM_PROVIDER=openai_compat          # openai_compat | gemini
LLM_BASE_URL=http://10.8.0.82:8000/v1   # vLLM en la EVO-X2 (vía OpenVPN) — confirmar IP
LLM_API_KEY=EMPTY
MODEL_MAIN=Qwen3.8-27B              # nombre exacto según GET /v1/models
MODEL_SQL=Qwen3.8-27B
MODEL_VISION=gemini-3.5-flash       # hasta arreglar la visión de gemma-4-31B
GOOGLE_API_KEY=...                  # respaldo
DATABASE_URL=postgresql+psycopg://zeny_lector:...@localhost:5434/zeny
```

`common/llm.py` devuelve `ChatOpenAI(base_url=..., model=...)` o `ChatGoogleGenerativeAI` según
`LLM_PROVIDER`, con un modelo **por rol**. Así se puede mezclar: SQL local y visión en Gemini.

### 7.5 Lo que Zeny sabe (prompt principal)

- Qué es la planta: 1034,9 kWp, 5 inversores Huawei (990 kW AC), 26 trackers de eje único, estación
  meteorológica y subestación tipo shelter.
- Conceptos: GHI vs POA, PR, pérdidas AC, seguimiento y posición de defensa por viento, limpieza/soiling,
  efecto térmico y batería del controlador.
- Cómo trabajar: (1) revisar primero `operacion.alertas` (lo que ya detectaron las reglas); (2) delegar
  consultas en paralelo; (3) citar solo cifras devueltas por los subagentes; (4) «sin dato» ≠ cero; (5) las
  causas son **hipótesis a verificar en campo**; (6) toda acción pasa por `proponer_accion`.

---

## 8. Plan de trabajo para mañana

Estimación para una persona con asistencia de IA. Se ordena para tener **siempre algo demostrable**.

| # | Paso | Entregable | Tiempo | Corte mínimo de la demo |
|---|---|---|---|---|
| 1 | Estructura del repo, `pyproject` (uv) y copia del `.toml` | Repo listo | 20 min | ✅ |
| 2 | `db/schema.sql` con tablas, `COMMENT ON` y roles | Esquema en `zeny-db` | 1 h | ✅ |
| 3 | ETL xlsx → Postgres + validaciones | Datos de septiembre cargados | 1,5 h | ✅ |
| 4 | Vistas de `analitica` | Métricas consultables | 1 h | ✅ (al menos energía horaria y tracker vs flota) |
| 5 | Backend: copiar AITinkeres, `llm.py` configurable, prueba contra la EVO-X2 | El modelo local responde con tools | 1 h | ✅ |
| 6 | Migrar el agente a deepagents (Zeny + analista-sql) y prompts del dominio | Chat que responde sobre la planta | 1,5 h | ✅ |
| 7 | Motor de reglas R1, R4, R6, R7 y R10 | `operacion.alertas` poblada | 1,5 h | Deseable |
| 8 | Grafana: datasource `zeny-db` + dashboard base | Panel en el iframe | 45 min | Deseable |
| 9 | `proponer_accion` con gate e inspector-visual | Aprobación en la UI | 1 h | Deseable |

**Si el tiempo aprieta:** los pasos 1 a 6 ya permiten mostrar «Zeny entiende la planta y responde con
datos reales usando un modelo local». Las reglas (7) son lo siguiente más valioso porque materializan el
principio de §1.

### Guion de demo (5 min)

1. «¿Cómo le fue a la planta en septiembre?» → resumen + panel de energía vs POA en Grafana.
2. «¿Qué alertas hay y cuáles son las más importantes?» → Zeny lee las alertas de las reglas y las prioriza.
3. «¿Hay trackers con problemas?» → dos subagentes en paralelo (posición y batería) → hallazgo concreto.
4. «¿Confías en los datos de la estación?» → detecta huecos y el sensor de temperatura ambiente implausible.
5. «Propón qué hacer» → `proponer_accion` (p. ej. inspección del Tracker N) → aprobación en la tablet → registrada.

---

## 9. Hoja de ruta (para presentar, no para mañana)

1. **Colector en vivo**: reemplazar el ETL de archivos por lectura Modbus TCP/SunSpec (inversores Huawei,
   medidor) y la API o protocolo de los controladores de los trackers → mismas tablas de `telemetria`.
2. **Reglas en tiempo real** y alertas proactivas: el agente se despierta ante una alerta, no solo al chatear.
3. **Acciones reales** sobre equipos, siempre detrás de interlocks de hardware + reglas + aprobación humana.
4. **Cámaras**: YOLO detecta → reglas filtran → el agente decide con contexto (sensor, hora, clase detectada) → humano/policía.
5. **Reportes con conexión intermitente**: cola local (*store-and-forward*) que envía cuando hay internet.
6. Todo corriendo **dentro de la EVO-X2** (vLLM + Postgres + backend + Grafana). Ojo: el backend no puede
   usar el puerto 8000 allí (lo ocupa vLLM).

---

## 10. Preguntas abiertas

| # | Pregunta | Afecta a |
|---|---|---|
| P1 | IP exacta de la EVO-X2 en la VPN y nombres de los modelos en `GET /v1/models` | §7.4 |
| P2 | ¿vLLM se lanzó con `--enable-auto-tool-choice` y un `--tool-call-parser`? | Paralelismo, tools |
| P3 | ¿Qué significa exactamente el umbral de soiling «5 %» si la limpieza media es ~79 %? | R3 |
| P4 | ¿Por qué los inversores y la frontera difieren tanto (máx. ~2976 vs ~1070 kWh/h)? ¿Unidades o acumulados? | R8, vistas de energía |
| P5 | ¿Por qué hay 22 trackers con datos si el catálogo tiene 26? | R5 |
| P6 | ¿Se mantiene Grafana embebido para la expo o se migra a A2UI (componentes generados por el agente)? | Frontend |
| P7 | Relación con `agente-zeny` (WhatsApp, PDF): ¿se integra después o es un proyecto aparte? | Hoja de ruta |

---

## 11. Estructura propuesta del repositorio

```text
Zeny/
├── PLAN.md
├── config/planta_joropo.toml
├── db/
│   ├── schema.sql          # tablas + COMMENT ON + roles
│   └── views.sql           # esquema analitica
├── etl/cargar_xlsx.py
├── reglas/                 # motor de reglas fijas (R1..R10)
├── backend/                # FastAPI + deepagents (base: AITinkeres)
│   └── app/
│       ├── agents/{zeny.py, analista_sql.py, inspector_visual.py, gate.py}
│       ├── common/{llm.py, db.py, diccionario.py}
│       └── prompts.py
├── frontend/               # Next.js + CopilotKit (base: AITinkeres)
├── infra/docker-compose.yaml   # Grafana + renderer (+ zeny-db más adelante)
├── tests/                  # ETL y reglas (deterministas: sí se testean)
└── Makefile                # db, etl, reglas, dev-backend, dev-frontend
```

> Nota de puertos: el Northwind de AITinkeres (`example-db`) también usa el **5434**. Hay que apagarlo antes
> de levantar `zeny-db`.

---

## 12. Implementado (2026-10-16)

| Pieza | Archivo | Estado |
|---|---|---|
| Esquema + diccionario en `COMMENT ON` | `db/schema.sql`, `db/views.sql` | ✅ 355k filas, 6 vistas |
| ETL idempotente (sha256) + rol `zeny_lector` de solo lectura | `etl/cargar_xlsx.py` | ✅ 21 s |
| Agente principal `zeny`: conversa, planea (`write_todos`), delega (`task`) y **grafica** (`crear_grafica`) | `backend/app/agents/zeny.py` | ✅ |
| Subagente `analista-sql` (`ejecutar_sql`): investiga y devuelve hallazgos + SQL verificado, en paralelo | `backend/app/agents/tools_sql.py` | ✅ |
| Gráficas en vivo: estado `charts` + `manually_emit_state` | `docs/CONTRATO_UI.md` | ✅ |
| Servidor AG-UI `:8100/agui` | `backend/app/api.py` | ✅ |
| Frontend CopilotKit con lienzo de gráficas `:3002` | `frontend/` | ✅ probado de punta a punta |

Decisiones tomadas al implementar:
- **Sin `create_deep_agent`**: se usan sus piezas (`SubAgentMiddleware`, `TodoListMiddleware`) sobre
  `create_agent` para no exponer las tools de archivos a un modelo local. El paralelismo se mantiene.
- **Los datos de las gráficas nunca entran al contexto de un LLM**: Zeny llama `crear_grafica` con el SQL
  que le verificó el analista; la tool lo ejecuta y publica, y Zeny recibe solo «gráfica publicada (N filas)».
- **El texto de los subagentes no se transmite al chat** (`emit-messages: False`); solo habla Zeny.
- **Driver async (psycopg 3 + pool)**: las consultas de subagentes paralelos no se bloquean entre sí.
  El cuello de botella real es el LLM (ver abajo).

Hallazgos sobre la EVO-X2 (2026-10-16):
- Con `--tool-call-parser hermes`, Qwen3.8 devuelve las tool calls como texto XML
  (`<function=…><parameter=…>`) y no se parsean. Usar **`--tool-call-parser qwen3_coder`**.
- Qwen3.8-27B (denso, BF16) genera a **~4,3 tokens/s**: una pregunta con 2 subagentes (~5k tokens
  generados) tardaría ~20 min. Para conversación en vivo hace falta un modelo **MoE** (pocos parámetros
  activos) o Gemini como respaldo. `--max-num-seqs 2` limita además a 2 peticiones simultáneas.

---

## 13. Streaming en vivo y decisión sobre Grafana (2026-10-16)

**Grafana:** descartado como camino principal para la expo. El lienzo AG-UI nativo ya cubre las gráficas y
se ve más "en vivo" que un iframe. Grafana queda como opción futura ("guardar como panel" para dashboards
permanentes de operación); no bloquea nada.

**Modo trabajo en vivo (para la expo):** el backend emite razonamiento (REASONING_*), lifecycle de
subagentes (SUBAGENT_*) y tool calls/resultados etiquetados con `subagentRunId`. Verificado con Gemini
(stream real en `docs/ejemplo_stream_agui.sse`):
- `subagent_visibility="attributed"` en `api.py`.
- `thinking_main`/`thinking_sql` por defecto en True; Gemini con `include_thoughts` + `thinking_budget`;
  Qwen3 con `enable_thinking` (vLLM ya tiene `--reasoning-parser qwen3`).
- Se dejó de silenciar a los subagentes (antes `emit-messages:False`): ahora su actividad se enruta a su
  tarjeta por `subagentRunId`.
Contrato de eventos en `docs/CONTRATO_UI.md` (sección "Streaming en vivo"). Pensado para que, con los
modelos lentos de la EVO-X2 (GPU ROCm, ~4 tok/s), el público vea el avance; con Gemini llega rápido.

Pendiente de medir: razonamiento de Gemini viene en inglés (secundario); con Qwen3 vendría en español.
