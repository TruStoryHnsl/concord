interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  className?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  className = "",
}: SliderProps) {
  const displayValue = formatValue ? formatValue(value) : value.toString();
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm text-on-surface">{label}</label>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-container-highest
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:[box-shadow:var(--shadow-sm)]
          [&::-webkit-slider-thumb]:hover:bg-zinc-200 [&::-webkit-slider-thumb]:transition-colors
          [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:[box-shadow:var(--shadow-sm)]
          [&::-moz-range-thumb]:hover:bg-zinc-200 [&::-moz-range-thumb]:transition-colors"
        style={{
          background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${percent}%, var(--color-surface-container-highest) ${percent}%, var(--color-surface-container-highest) 100%)`,
        }}
      />
    </div>
  );
}
