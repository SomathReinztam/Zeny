import Image from "next/image";
import type { Todo } from "../lib/types";
import { IconCheck } from "./icons";

const FICHA = ["1034,9 kWp", "5 inversores Huawei", "26 trackers", "Estación meteo", "Medidor de frontera"];

export function Header({ running, demo }: { running: boolean; demo: boolean }) {
  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface/85 px-5 py-3 backdrop-blur lg:px-7">
      <Image
        src="/brand/zentrack-logo.webp"
        alt="Zentrack"
        width={1000}
        height={179}
        priority
        className="h-7 w-auto shrink-0 lg:h-8"
      />
      <span className="hidden h-8 w-px bg-line sm:block" />
      <div className="min-w-0 flex-1">
        <h1 className="font-display truncate text-[1.25rem] font-semibold leading-tight text-ink lg:text-[1.4rem]">
          Panel de Zeny
        </h1>
        <p className="truncate text-[13px] text-ink-3">Minigranja solar Joropo · Colombia</p>
      </div>
      <div className="hidden flex-wrap justify-end gap-1.5 xl:flex">
        {FICHA.map((f) => (
          <span
            key={f}
            className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2"
          >
            {f}
          </span>
        ))}
      </div>
      {demo ? (
        <span className="rounded-full bg-[#1a1a1a] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#fd9c10]">
          Demo
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="hidden text-right sm:block">
          <div className="text-[13px] font-semibold text-ink">Zeny</div>
          <div className="flex items-center justify-end gap-1.5 text-[12px] text-ink-3">
            <span
              className={`inline-block h-2 w-2 rounded-full ${running ? "pulse-dot bg-accent" : "bg-ok"}`}
            />
            {running ? "Analizando…" : "Lista para ayudarte"}
          </div>
        </div>
        <div
          className={`relative h-12 w-12 overflow-hidden rounded-full border-2 bg-accent-soft transition ${
            running ? "border-accent" : "border-line"
          }`}
        >
          <Image
            src="/brand/zeny-256.webp"
            alt="Zeny"
            width={256}
            height={295}
            className="absolute top-0.5 left-1/2 w-[46px] max-w-none -translate-x-1/2"
          />
        </div>
      </div>
    </header>
  );
}

export function PlanStrip({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null;
  const hechos = todos.filter((t) => t.status === "completed").length;
  const pct = Math.round((hechos / todos.length) * 100);
  return (
    <section
      className="anim-card-in rounded-[var(--radius)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]"
      aria-label="Plan de trabajo de Zeny"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display text-[15px] font-semibold text-ink">Plan de trabajo</h2>
        <span className="text-[13px] tabular text-ink-3">
          {hechos} de {todos.length}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <ol className="mt-3 flex flex-wrap gap-2">
        {todos.map((t, i) => {
          const hecho = t.status === "completed";
          const activo = t.status === "in_progress";
          return (
            <li
              key={`${i}-${t.content}`}
              className={`flex max-w-full items-start gap-2 rounded-xl border px-3 py-2 text-[13.5px] leading-snug transition ${
                activo
                  ? "border-accent bg-accent-soft text-ink shadow-[0_0_0_3px_var(--accent-ring)]"
                  : hecho
                    ? "border-line bg-surface-2 text-ink-3"
                    : "border-line bg-surface text-ink-2"
              }`}
            >
              <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center">
                {hecho ? (
                  <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-ok text-white">
                    <IconCheck size={12} strokeWidth={3} />
                  </span>
                ) : activo ? (
                  <span className="spinner" />
                ) : (
                  <span className="h-[16px] w-[16px] rounded-full border-2 border-line-strong" />
                )}
              </span>
              <span className={hecho ? "line-through decoration-ink-3/40" : undefined}>{t.content}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
