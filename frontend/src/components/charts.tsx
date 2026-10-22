import { useState } from "react";
import { cx } from "./ui";

/** Single-series column chart with a per-bar hover tooltip and a table fallback for screen readers. */
export function ColumnChart({
  data,
  label,
  height = 140,
}: {
  data: { key: string; label: string; value: number; tooltip: string }[];
  label: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const plotH = height - 22;
  return (
    <figure className="relative">
      <div className="relative flex" style={{ height }}>
        <div className="flex w-6 shrink-0 flex-col-reverse justify-between pb-[22px] text-right text-[10px] text-faint" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="relative ml-2 flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute right-0 left-0 border-t border-line/70" style={{ bottom: 22 + (t / top) * plotH }} aria-hidden="true" />
          ))}
          <div className="absolute inset-x-0 bottom-[22px] flex items-end gap-[2px]" style={{ height: plotH }}>
            {data.map((d, i) => (
              <button
                type="button"
                key={d.key}
                className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-offset-0"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={d.tooltip}
              >
                <span
                  className={cx("w-full max-w-7 rounded-t bg-chart transition-opacity", hover !== null && hover !== i && "opacity-40")}
                  style={{ height: d.value ? `${(d.value / top) * 100}%` : 0 }}
                />
              </button>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex gap-[2px] text-[10px] text-faint" aria-hidden="true">
            {data.map((d) => (
              <span key={d.key} className="flex-1 truncate text-center">
                {d.label}
              </span>
            ))}
          </div>
          {hover !== null && data[hover] && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-md"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, bottom: 26 + (data[hover]!.value / top) * plotH }}
            >
              {data[hover]!.tooltip}
            </div>
          )}
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for counts per category (single hue: the bars encode magnitude, the labels carry identity). */
export function BarList({
  data,
  onSelect,
}: {
  data: { key: string; label: string; value: number }[];
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-1.5">
      {data.map((d) => {
        const content = (
          <>
            <span className="w-24 shrink-0 truncate text-left text-xs text-muted">{d.label}</span>
            <span className="relative h-4 flex-1">
              <span className="absolute inset-y-0 left-0 rounded-r bg-chart" style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value ? 4 : 0 }} />
            </span>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink">{d.value}</span>
          </>
        );
        return (
          <li key={d.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(d.key)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-sunken"
                title={`${d.label}: ${d.value} — show these projects`}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-1 py-0.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Progress ring for one ratio. Shows "—" when there is nothing to measure. */
export function ProgressRing({ value, size = 64, label }: { value: number | null; size?: number; label: string }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={pct === null ? `${label}: not measured` : `${label}: ${pct}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sunken)" strokeWidth={stroke} />
        {pct !== null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-chart)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : Math.ceil(max / 5 / 5) * 5;
  const out: number[] = [];
  for (let v = 0; v <= max + step - 1; v += step) {
    out.push(v);
    if (v >= max) break;
  }
  return out;
}
