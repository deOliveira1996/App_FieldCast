import React, { useEffect, useRef, useState } from 'react';

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number | string | null | undefined;
  onValueChange?: (rawDraft: string, parsedValue: number | null) => void;
  onCommit?: (committedValue: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  allowNegative?: boolean;
  allowEmpty?: boolean;
  fallbackValue?: number;
}

const ALLOWED_NAVIGATION_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Tab',
  'Enter',
  'Home',
  'End',
  'Escape',
]);

function formatExternalValue(
  value: number | string | null | undefined,
  decimals?: number,
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return decimals !== undefined ? value.toFixed(decimals) : String(value);
  }
  return String(value);
}

function sanitizeNumericDraft(raw: string, canBeNegative: boolean): string {
  const normalized = raw.replace(/,/g, '.');
  let out = '';
  let hasDot = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (ch === '.' && !hasDot) {
      hasDot = true;
      out += '.';
    } else if (ch === '-' && canBeNegative && out.length === 0) {
      out += '-';
    }
  }

  return out;
}

function clampNumericValue(val: number, min?: number, max?: number): number {
  let clamped = val;
  if (min !== undefined && clamped < min) {
    clamped = min;
  }
  if (max !== undefined && clamped > max) {
    clamped = max;
  }
  return clamped;
}

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      value,
      onValueChange,
      onCommit,
      min,
      max,
      step: _step,
      decimals,
      allowNegative,
      allowEmpty = true,
      fallbackValue,
      className = '',
      onFocus,
      onBlur,
      onKeyDown,
      inputMode = 'decimal',
      ...rest
    },
    ref,
  ) => {
    const canBeNegative = allowNegative ?? (min !== undefined && min < 0);
    const isFocusedRef = useRef(false);
    const [draft, setDraft] = useState<string>(() => formatExternalValue(value, decimals));

    useEffect(() => {
      if (!isFocusedRef.current) {
        setDraft(formatExternalValue(value, decimals));
      }
    }, [value, decimals]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = true;
      onFocus?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !ALLOWED_NAVIGATION_KEYS.has(e.key)) {
        if (e.key === 'e' || e.key === 'E' || e.key === '+') {
          e.preventDefault();
          return;
        }
        if (e.key === '-' && !canBeNegative) {
          e.preventDefault();
          return;
        }
      }
      onKeyDown?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeNumericDraft(e.target.value, canBeNegative);
      setDraft(sanitized);

      if (sanitized === '') {
        onValueChange?.('', null);
        return;
      }

      if (sanitized === '-' || sanitized === '.' || sanitized === '-.') {
        onValueChange?.(sanitized, null);
        return;
      }

      const parsed = Number(sanitized);
      if (Number.isFinite(parsed)) {
        onValueChange?.(sanitized, parsed);
      } else {
        onValueChange?.(sanitized, null);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = false;

      const isIncomplete =
        draft === '' || draft === '-' || draft === '.' || draft === '-.';

      if (isIncomplete) {
        if (allowEmpty === false && fallbackValue !== undefined && Number.isFinite(fallbackValue)) {
          const clampedFallback = clampNumericValue(fallbackValue, min, max);
          const finalNum =
            decimals !== undefined
              ? Number(clampedFallback.toFixed(decimals))
              : clampedFallback;
          const finalStr =
            decimals !== undefined ? finalNum.toFixed(decimals) : String(finalNum);
          setDraft(finalStr);
          onCommit?.(finalNum);
          onValueChange?.(finalStr, finalNum);
        } else {
          setDraft('');
          onCommit?.(null);
          onValueChange?.('', null);
        }
        onBlur?.(e);
        return;
      }

      const parsed = Number(draft);
      if (!Number.isFinite(parsed)) {
        if (allowEmpty === false && fallbackValue !== undefined && Number.isFinite(fallbackValue)) {
          const clampedFallback = clampNumericValue(fallbackValue, min, max);
          const finalNum =
            decimals !== undefined
              ? Number(clampedFallback.toFixed(decimals))
              : clampedFallback;
          const finalStr =
            decimals !== undefined ? finalNum.toFixed(decimals) : String(finalNum);
          setDraft(finalStr);
          onCommit?.(finalNum);
          onValueChange?.(finalStr, finalNum);
        } else {
          setDraft('');
          onCommit?.(null);
          onValueChange?.('', null);
        }
        onBlur?.(e);
        return;
      }

      const clamped = clampNumericValue(parsed, min, max);
      const finalNum =
        decimals !== undefined ? Number(clamped.toFixed(decimals)) : clamped;
      const finalStr =
        decimals !== undefined ? finalNum.toFixed(decimals) : String(finalNum);

      setDraft(finalStr);
      onCommit?.(finalNum);
      onValueChange?.(finalStr, finalNum);
      onBlur?.(e);
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode={inputMode}
        value={draft}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onBlur={handleBlur}
        className={className}
        {...rest}
      />
    );
  },
);

NumericInput.displayName = 'NumericInput';
