import {useEffect, useRef} from 'react';

export function useDebouncedSetting() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() {
    clearTimeout(timer.current);
    timer.current = undefined;
  }
  function schedule(commit: () => void) {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      commit();
    }, 350);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  return {schedule, cancel};
}
