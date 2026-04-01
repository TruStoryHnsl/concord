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
        <label className="text-sm text-zinc-300">{label}</label>
        <span className="text-xs text-zinc-500 tabular-nums">
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
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-zinc-700
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:hover:bg-zinc-200 [&::-webkit-slider-thumb]:transition-colors
          [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-md
          [&::-moz-range-thumb]:hover:bg-zinc-200 [&::-moz-range-thumb]:transition-colors"
        style={{
          background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${percent}%, #3f3f46 ${percent}%, #3f3f46 100%)`,
        }}
      />
    </div>
  );
}
