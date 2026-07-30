import type { ReactNode } from "react";

export function Section({ title, description, children }: {
  title: string; description?: string; children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header><h2>{title}</h2>{description && <p>{description}</p>}</header>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, wide = false }: {
  label: string; hint?: string; children: ReactNode; wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-copy"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className="field-control">{children}</span>
    </label>
  );
}

export function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    ><span /></button>
  );
}

export function Range({ value, min, max, step = 1, unit = "", onChange }: {
  value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <span className="range-control">
      <input
        type="range" value={value} min={min} max={max} step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--progress": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <output>{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</output>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return (
    <span className="segmented">
      {options.map((option) => (
        <button
          type="button" key={option.value}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >{option.label}</button>
      ))}
    </span>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <span className="color-input">
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <code>{value.toUpperCase()}</code>
    </span>
  );
}

