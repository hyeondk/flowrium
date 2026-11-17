import { Minus, Plus } from 'lucide-react';

type Props = {
  label: string;
  value: string;
  onChange(value: string): void;
  min: number;
  max?: number;
  decimal?: boolean;
};

export function NumericStepper({label, value, onChange, min, max, decimal = false}: Props) {
  const number = value.trim() === '' ? undefined : Number(value);
  function step(amount: number) {
    const current = Number.isFinite(number) ? number! : min - (amount > 0 ? 1 : 0);
    onChange(String(Math.max(min, Math.min(max ?? Infinity, current + amount))));
  }
  return <span className="numeric-stepper">
    <button type="button" aria-label={label + ' 줄이기'} disabled={number !== undefined && number <= min} onClick={() => step(-1)}><Minus size={15}/></button>
    <input type="text" role="spinbutton" aria-label={label} inputMode={decimal ? 'decimal' : 'numeric'}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number.isFinite(number) ? number : undefined}
      value={value} pattern={decimal ? '(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)' : '[0-9]+'}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          step(event.key === 'ArrowUp' ? 1 : -1);
        }
      }}/>
    <button type="button" aria-label={label + ' 늘리기'} disabled={max !== undefined && number !== undefined && number >= max} onClick={() => step(1)}><Plus size={15}/></button>
  </span>;
}
