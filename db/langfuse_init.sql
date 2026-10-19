-- Crea el rol y la base de Langfuse DENTRO del Postgres de zeny-db, sin tocar zeny_agent_db.
-- Idempotente: se puede correr varias veces. Langfuse corre sus migraciones solo al arrancar.
--
-- Aplicar (la contraseña viaja como variable de entorno del proceso psql):
--   docker exec -e LANGFUSE_DB_PASS='...' -i zeny-db psql -U postgres -d postgres < db/langfuse_init.sql
-- o, más cómodo:  make langfuse-db   (lee LANGFUSE_DB_PASS del .env del repo)

-- Toma la contraseña del entorno (psql >= 16). Si falta, aborta sin crear nada.
\getenv db_pass LANGFUSE_DB_PASS
\if :{?db_pass}
\else
  \echo '>>> ERROR: define LANGFUSE_DB_PASS en el entorno antes de correr este script.'
  \quit
\endif

-- 1) Rol de login `langfuse` (crea si no existe)...
SELECT format('CREATE ROLE langfuse LOGIN PASSWORD %L', :'db_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'langfuse')\gexec

-- ...y asegura login + contraseña aunque el rol ya existiera.
ALTER ROLE langfuse WITH LOGIN PASSWORD :'db_pass';

-- 2) Base `langfuse` propiedad de ese rol (CREATE DATABASE no admite IF NOT EXISTS → \gexec condicional).
SELECT 'CREATE DATABASE langfuse OWNER langfuse'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse')\gexec

\echo '>>> Langfuse: rol y base listos en zeny-db.'
