import { useId, useRef, useState, type KeyboardEvent } from 'react';

export interface ComboboxOption<T extends string> {
  value: T;
  label: string;
}

interface ComboboxProps<T extends string> {
  id?: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ComboboxOption<T>[];
  disabled?: boolean;
}

export default function Combobox<T extends string>({
  id: providedId,
  label,
  value,
  onChange,
  options,
  disabled = false,
}: ComboboxProps<T>) {
  const autoId = useId().replace(/:/g, '');
  const id = providedId || autoId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  function selectOption(option: ComboboxOption<T>) {
    onChange(option.value);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(options.findIndex((option) => option.value === value));
      } else {
        setActiveIndex((current) => (current + 1) % Math.max(options.length, 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(options.findIndex((option) => option.value === value));
      } else {
        setActiveIndex((current) => (current - 1 + options.length) % Math.max(options.length, 1));
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open && options[activeIndex]) {
        selectOption(options[activeIndex]);
      } else {
        setOpen(true);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} id={`${id}-label`} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        readOnly
        value={selected?.label ?? ''}
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
        onFocus={() => {
          if (!disabled) setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setOpen(false)}
        className="mt-1 block w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => {
                event.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-slate-700'
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
