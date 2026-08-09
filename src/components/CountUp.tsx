import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  end: number;
  duration?: number;
  formattingFn?: (value: number) => string;
  preserveValue?: boolean;
}

/**
 * 轻量级数字滚动动画组件（原生 ESM，替代 react-countup）。
 * 使用 requestAnimationFrame 实现缓动动画。
 */
export default function CountUp({
  end,
  duration = 0.8,
  formattingFn,
  preserveValue = false,
}: CountUpProps) {
  const [displayValue, setDisplayValue] = useState(end);
  const rafRef = useRef<number | null>(null);
  const startValRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  const format = (v: number) => (formattingFn ? formattingFn(v) : String(v));

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    const startVal = preserveValue ? startValRef.current : 0;
    startValRef.current = end;
    startTimeRef.current = null;

    if (duration <= 0) {
      setDisplayValue(end);
      return;
    }

    const animate = (ts: number) => {
      if (startTimeRef.current === null) startTimeRef.current = ts;
      const elapsed = ts - startTimeRef.current;
      const progress = Math.min(elapsed / (duration * 1000), 1);
      // easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = startVal + (end - startVal) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, duration]);

  return <span>{format(displayValue)}</span>;
}
