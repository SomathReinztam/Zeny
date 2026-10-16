-- Esquema de Zeny v0 (idempotente). Los COMMENT ON son el diccionario de datos:
-- el prompt del subagente analista-sql se genera a partir de ellos.

CREATE SCHEMA IF NOT EXISTS planta;
CREATE SCHEMA IF NOT EXISTS telemetria;
CREATE SCHEMA IF NOT EXISTS analitica;

COMMENT ON SCHEMA planta IS 'Catálogo de equipos de la minigranja Joropo y parámetros/umbrales operativos.';
COMMENT ON SCHEMA telemetria IS 'Series de tiempo medidas, ya limpias. Marcas de tiempo en hora local de Colombia (America/Bogota). NULL = sin dato (nunca es cero).';
COMMENT ON SCHEMA analitica IS 'Vistas con métricas calculadas (horarias, diarias, calidad de datos). Preferirlas a recalcular desde telemetria.';

-- ── planta ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planta.trackers (
    tracker_id text PRIMARY KEY,
    numero     int  NOT NULL UNIQUE,
    nombre     text NOT NULL
);
COMMENT ON TABLE planta.trackers IS 'Seguidores solares (trackers) de eje único. Tracker = TCU = controlador = seguidor: son el mismo equipo. Hay 26 en el catálogo; no todos reportan datos. Nombrarlos siempre como "Tracker N (ID)".';
COMMENT ON COLUMN planta.trackers.tracker_id IS 'ID de hardware de 6 caracteres derivado de la MAC (p. ej. EFF378). Es la clave que usan las tablas de telemetria.';
COMMENT ON COLUMN planta.trackers.numero IS 'Número del tracker en planta (1..26).';
COMMENT ON COLUMN planta.trackers.nombre IS 'Nombre legible, p. ej. "Tracker 1".';

CREATE TABLE IF NOT EXISTS planta.inversores (
    inversor_id         int PRIMARY KEY,
    nombre              text NOT NULL,
    modelo              text NOT NULL,
    potencia_nominal_kw numeric NOT NULL
);
COMMENT ON TABLE planta.inversores IS 'Inversores Huawei de la planta (990 kW AC en total). OJO: no hay telemetría por inversor, solo la energía agregada en telemetria.energia_inversores.';

CREATE TABLE IF NOT EXISTS planta.parametros (
    clave       text PRIMARY KEY,
    valor       numeric NOT NULL,
    unidad      text,
    descripcion text NOT NULL
);
COMMENT ON TABLE planta.parametros IS 'Constantes de la planta y umbrales operativos (potencia instalada, umbral de viento, etc.). Consultar aquí en vez de inventar valores.';

-- ── telemetria ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS telemetria.tracker_posicion (
    tracker_id text NOT NULL REFERENCES planta.trackers(tracker_id),
    ts         timestamptz NOT NULL,
    pitch_deg  double precision NOT NULL,
    PRIMARY KEY (tracker_id, ts)
);
COMMENT ON TABLE telemetria.tracker_posicion IS 'Ángulo de inclinación de cada tracker, una muestra cada pocos minutos por tracker (muestreo irregular). Fuente: reporte_posicion_*.xlsx.';
COMMENT ON COLUMN telemetria.tracker_posicion.pitch_deg IS 'Ángulo pitch en grados. Rango mecánico -60..60. ~0° = horizontal (también es la posición de defensa contra viento). Durante el día los trackers siguen al sol de un extremo al otro; de noche suelen quedar en una posición fija. Los negativos son legítimos.';

CREATE TABLE IF NOT EXISTS telemetria.tracker_electrica (
    tracker_id  text NOT NULL REFERENCES planta.trackers(tracker_id),
    ts          timestamptz NOT NULL,
    i_bateria_a double precision,
    i_panel_a   double precision,
    v_bateria_v double precision,
    v_panel_v   double precision,
    PRIMARY KEY (tracker_id, ts)
);
COMMENT ON TABLE telemetria.tracker_electrica IS 'Electrónica propia del controlador ("brain") de cada tracker: su batería y su pequeño panel de autoalimentación. NO es la energía de la planta. Muestreo MUY irregular: solo pocos trackers reportan con regularidad. Fuente: brain_electrics*.xlsx.';
COMMENT ON COLUMN telemetria.tracker_electrica.i_bateria_a IS 'Corriente de la batería del controlador (A). Negativa = descarga, positiva = carga.';
COMMENT ON COLUMN telemetria.tracker_electrica.i_panel_a IS 'Corriente del panel de autoalimentación del controlador (A).';
COMMENT ON COLUMN telemetria.tracker_electrica.v_bateria_v IS 'Voltaje de la batería del controlador (V). Nominal ~26 V; < 23,5 V se considera batería baja.';
COMMENT ON COLUMN telemetria.tracker_electrica.v_panel_v IS 'Voltaje de entrada del panel de autoalimentación (V). Puede ser negativo de noche.';

CREATE TABLE IF NOT EXISTS telemetria.clima (
    ts                   timestamptz PRIMARY KEY,
    viento_ms            double precision,
    viento_dir_deg       double precision,
    lluvia_mm            double precision,
    ghi_wm2              double precision,
    temp_ambiente_c      double precision,
    temp_panel_c         double precision,
    poa_wm2              double precision,
    limpieza_pct         double precision,
    v_bateria_estacion_v double precision
);
COMMENT ON TABLE telemetria.clima IS 'Estación meteorológica central, ~1 muestra por minuto. Los -1 del reporte original (lectura inválida) se guardaron como NULL. Fuente: reporte_clima*.xlsx.';
COMMENT ON COLUMN telemetria.clima.viento_ms IS 'Velocidad del viento (m/s). Umbral de viento fuerte: ver planta.parametros (viento_alerta_ms).';
COMMENT ON COLUMN telemetria.clima.viento_dir_deg IS 'Dirección del viento (grados, 0 = norte).';
COMMENT ON COLUMN telemetria.clima.lluvia_mm IS 'Lluvia acumulada en el intervalo de la muestra (mm). Sumar para totales.';
COMMENT ON COLUMN telemetria.clima.ghi_wm2 IS 'Irradiancia global horizontal GHI (W/m²).';
COMMENT ON COLUMN telemetria.clima.temp_ambiente_c IS 'Temperatura ambiente (°C). ADVERTENCIA: lecturas sospechosas (supera a la del panel con frecuencia y llega a ~65 °C); tratar con cautela.';
COMMENT ON COLUMN telemetria.clima.temp_panel_c IS 'Temperatura de módulo, sensor trasero (°C). > 60 °C implica pérdidas térmicas relevantes (coef. -0,35 %/°C).';
COMMENT ON COLUMN telemetria.clima.poa_wm2 IS 'Irradiancia en el plano del arreglo POA (W/m²). Es la referencia principal de energía solar incidente para evaluar desempeño.';
COMMENT ON COLUMN telemetria.clima.limpieza_pct IS 'LIMPIEZA de los paneles (%): 100 = limpio, menor = más sucio. El reporte original la llama "Suciedad (%)" pero significa limpieza. Citar siempre como "limpieza del X %".';
COMMENT ON COLUMN telemetria.clima.v_bateria_estacion_v IS 'Voltaje de la batería de la propia estación meteorológica (V).';

CREATE TABLE IF NOT EXISTS telemetria.energia_inversores (
    ts  timestamptz PRIMARY KEY,
    kwh double precision
);
COMMENT ON TABLE telemetria.energia_inversores IS 'Energía generada por los 5 inversores en conjunto (agregada, sin detalle por inversor), una fila por hora. ts = inicio de la hora. kwh NULL = sin dato. Fuente: inversores_generacion_*.xlsx.';
COMMENT ON COLUMN telemetria.energia_inversores.kwh IS 'Energía en la hora (kWh). Capacidad AC máx. 990 kW → valores > 990 kWh/h son inconsistentes.';

CREATE TABLE IF NOT EXISTS telemetria.energia_frontera (
    ts  timestamptz PRIMARY KEY,
    kwh double precision
);
COMMENT ON TABLE telemetria.energia_frontera IS 'Energía exportada a la red medida en la subestación tipo Shelter (medidor Quoia / frontera), cada 15 min. ts = inicio del intervalo. Es la energía neta realmente vendida. Fuente: quoia_mediciones_*.xlsx.';
COMMENT ON COLUMN telemetria.energia_frontera.kwh IS 'Energía exportada en el intervalo de 15 min (kWh).';

CREATE TABLE IF NOT EXISTS telemetria.cargas (
    id                serial PRIMARY KEY,
    archivo           text NOT NULL,
    sha256            text NOT NULL UNIQUE,
    tabla             text NOT NULL,
    filas             int NOT NULL,
    filas_descartadas int NOT NULL,
    cargado_en        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE telemetria.cargas IS 'Registro técnico de las cargas del ETL (no es telemetría de la planta).';

CREATE INDEX IF NOT EXISTS tracker_posicion_ts_idx ON telemetria.tracker_posicion (ts);
CREATE INDEX IF NOT EXISTS tracker_electrica_ts_idx ON telemetria.tracker_electrica (ts);
