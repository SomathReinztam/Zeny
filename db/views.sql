-- Vistas de métricas (esquema analitica). CREATE OR REPLACE: se reaplican en cada carga.

CREATE OR REPLACE VIEW analitica.v_clima_horario AS
SELECT
    date_trunc('hour', ts)            AS hora,
    count(*)                          AS n_muestras,
    avg(poa_wm2)                      AS poa_wm2_prom,
    avg(poa_wm2) / 1000.0             AS poa_kwh_m2,
    avg(ghi_wm2)                      AS ghi_wm2_prom,
    max(viento_ms)                    AS viento_ms_max,
    avg(viento_ms)                    AS viento_ms_prom,
    sum(lluvia_mm)                    AS lluvia_mm,
    avg(temp_panel_c)                 AS temp_panel_c_prom,
    max(temp_panel_c)                 AS temp_panel_c_max,
    avg(temp_ambiente_c)              AS temp_ambiente_c_prom,
    avg(limpieza_pct)                 AS limpieza_pct_prom
FROM telemetria.clima
GROUP BY 1;
COMMENT ON VIEW analitica.v_clima_horario IS 'Clima agregado por hora (hora = inicio). poa_kwh_m2 = irradiación POA de la hora en kWh/m². n_muestras esperado ≈ 60.';

CREATE OR REPLACE VIEW analitica.v_energia_horaria AS
WITH frontera AS (
    SELECT date_trunc('hour', ts) AS hora, sum(kwh) AS kwh, count(kwh) AS n_intervalos
    FROM telemetria.energia_frontera GROUP BY 1
),
pinst AS (SELECT valor AS kwp FROM planta.parametros WHERE clave = 'potencia_instalada_kwp')
SELECT
    c.hora,
    i.kwh                                   AS kwh_inversores,
    f.kwh                                   AS kwh_frontera,
    f.n_intervalos                          AS n_intervalos_frontera,
    c.poa_kwh_m2,
    c.temp_panel_c_prom,
    CASE WHEN c.poa_kwh_m2 > 0.05 AND f.kwh IS NOT NULL
         THEN f.kwh / ((SELECT kwp FROM pinst) * c.poa_kwh_m2) END AS pr_frontera,
    CASE WHEN i.kwh > 0 AND f.kwh IS NOT NULL
         THEN (i.kwh - f.kwh) / i.kwh END   AS perdida_ac_frac
FROM analitica.v_clima_horario c
LEFT JOIN telemetria.energia_inversores i ON i.ts = c.hora
LEFT JOIN frontera f ON f.hora = c.hora;
COMMENT ON VIEW analitica.v_energia_horaria IS 'Energía por hora: inversores vs frontera vs irradiación POA. pr_frontera = PR de referencia = kWh_frontera / (kWp_instalado × kWh/m²_POA), solo con sol (POA > 0,05 kWh/m²). perdida_ac_frac = (inversores - frontera) / inversores. NULL = sin dato.';

CREATE OR REPLACE VIEW analitica.v_energia_diaria AS
WITH pinst AS (SELECT valor AS kwp FROM planta.parametros WHERE clave = 'potencia_instalada_kwp')
SELECT
    date_trunc('day', hora)::date                AS dia,
    sum(kwh_inversores)                          AS kwh_inversores,
    sum(kwh_frontera)                            AS kwh_frontera,
    count(kwh_inversores)                        AS horas_con_dato_inversores,
    count(kwh_frontera)                          AS horas_con_dato_frontera,
    sum(poa_kwh_m2)                              AS poa_kwh_m2,
    CASE WHEN sum(poa_kwh_m2) > 0.5
         THEN sum(kwh_frontera) / ((SELECT kwp FROM pinst) * sum(poa_kwh_m2)) END AS pr_frontera,
    CASE
        WHEN count(kwh_frontera) = 0 AND count(kwh_inversores) = 0 THEN 'sin_datos'
        WHEN sum(poa_kwh_m2) < 2 THEN 'dia_nublado'
        WHEN sum(kwh_frontera) / NULLIF((SELECT kwp FROM pinst) * sum(poa_kwh_m2), 0) < 0.6 THEN 'posible_falla'
        ELSE 'normal'
    END                                          AS clasificacion
FROM analitica.v_energia_horaria
GROUP BY 1;
COMMENT ON VIEW analitica.v_energia_diaria IS 'Resumen diario de energía. clasificacion: normal | dia_nublado (POA < 2 kWh/m²) | posible_falla (PR < 0,6 con sol suficiente) | sin_datos. Los umbrales son preliminares, por validar con operación.';

CREATE OR REPLACE VIEW analitica.v_tracker_vs_flota AS
WITH b AS (
    SELECT tracker_id,
           date_bin('15 minutes', ts, timestamptz '2026-01-01') AS ventana,
           avg(pitch_deg) AS pitch_deg
    FROM telemetria.tracker_posicion
    GROUP BY 1, 2
),
flota AS (
    SELECT ventana,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pitch_deg) AS pitch_mediana_flota,
           count(*) AS trackers_reportando
    FROM b GROUP BY 1
)
SELECT b.tracker_id, b.ventana, b.pitch_deg, f.pitch_mediana_flota, f.trackers_reportando,
       b.pitch_deg - f.pitch_mediana_flota AS desviacion_deg
FROM b JOIN flota f USING (ventana);
COMMENT ON VIEW analitica.v_tracker_vs_flota IS 'Pitch de cada tracker por ventana de 15 min comparado con la mediana de la flota en la misma ventana. |desviacion_deg| > 10 con sol sugiere un tracker trabado o desalineado. Consulta pesada: filtrar siempre por ventana de tiempo o tracker.';

CREATE OR REPLACE VIEW analitica.v_tracker_estado_diario AS
WITH pos AS (
    SELECT tracker_id, ts::date AS dia, count(*) AS muestras_posicion,
           min(pitch_deg) AS pitch_min, max(pitch_deg) AS pitch_max
    FROM telemetria.tracker_posicion GROUP BY 1, 2
),
ele AS (
    SELECT tracker_id, ts::date AS dia, count(*) AS muestras_electricas,
           min(v_bateria_v) AS v_bateria_min, avg(v_bateria_v) AS v_bateria_prom
    FROM telemetria.tracker_electrica GROUP BY 1, 2
)
SELECT t.tracker_id, t.numero, t.nombre, d.dia,
       coalesce(pos.muestras_posicion, 0)   AS muestras_posicion,
       coalesce(ele.muestras_electricas, 0) AS muestras_electricas,
       pos.pitch_min, pos.pitch_max,
       pos.pitch_max - pos.pitch_min        AS recorrido_deg,
       ele.v_bateria_min, ele.v_bateria_prom
FROM planta.trackers t
CROSS JOIN (SELECT DISTINCT ts::date AS dia FROM telemetria.clima) d
LEFT JOIN pos ON pos.tracker_id = t.tracker_id AND pos.dia = d.dia
LEFT JOIN ele ON ele.tracker_id = t.tracker_id AND ele.dia = d.dia;
COMMENT ON VIEW analitica.v_tracker_estado_diario IS 'Una fila por tracker del catálogo y día (incluye trackers sin datos, con muestras = 0). recorrido_deg pequeño en un día soleado sugiere un tracker inmóvil.';

CREATE OR REPLACE VIEW analitica.v_cobertura_datos AS
WITH dias AS (SELECT DISTINCT ts::date AS dia FROM telemetria.clima),
c AS (SELECT ts::date AS dia, count(*) n FROM telemetria.clima GROUP BY 1),
c_poa AS (SELECT ts::date AS dia, count(poa_wm2) n FROM telemetria.clima GROUP BY 1),
inv AS (SELECT ts::date AS dia, count(kwh) n FROM telemetria.energia_inversores GROUP BY 1),
fr AS (SELECT ts::date AS dia, count(kwh) n FROM telemetria.energia_frontera GROUP BY 1),
pos AS (SELECT ts::date AS dia, count(DISTINCT tracker_id) n FROM telemetria.tracker_posicion GROUP BY 1)
SELECT d.dia,
       round(100.0 * coalesce(c.n, 0) / 1440, 1)       AS clima_pct,
       round(100.0 * coalesce(c_poa.n, 0) / 1440, 1)   AS clima_poa_valida_pct,
       round(100.0 * coalesce(inv.n, 0) / 24, 1)       AS inversores_pct,
       round(100.0 * coalesce(fr.n, 0) / 96, 1)        AS frontera_pct,
       coalesce(pos.n, 0) AS trackers_reportando_posicion,
       (SELECT count(*) FROM planta.trackers) AS trackers_catalogo
FROM dias d
LEFT JOIN c USING (dia) LEFT JOIN c_poa USING (dia) LEFT JOIN inv USING (dia)
LEFT JOIN fr USING (dia) LEFT JOIN pos USING (dia);
COMMENT ON VIEW analitica.v_cobertura_datos IS 'Calidad de datos: % de muestras recibidas vs esperadas por fuente y día (clima 1/min, inversores 1/h, frontera 1/15 min, posición: cuántos de los trackers del catálogo reportaron ese día).';
