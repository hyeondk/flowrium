import {useCallback, useEffect, useRef} from 'react';
import {modelDisplayName} from '../shared/model-display';
import type {FlowriumAPI, Model} from '../shared/types';

type Catalog = Awaited<ReturnType<FlowriumAPI['connect']>>;
const refreshInterval = 5 * 60_000;

export function useModelCatalog(api:FlowriumAPI | undefined, active:boolean, setModels:(models:Model[])=>void, notify:(text:string)=>void) {
  const recent = useRef(0);
  const flight = useRef(false);
  const generation = useRef(0);
  const seen = useRef(new Map<string, string[]>());

  const accept = useCallback((catalog:Catalog) => {
    setModels(catalog.models);
    const owner = catalog.modelAccount;
    if (!catalog.status.authenticated || !owner || !catalog.models.length) return;
    const key = 'flowrium.model-list.' + owner;
    let previous = seen.current.get(key);
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null');
      if (!previous && Array.isArray(saved) && saved.every(id => typeof id === 'string')) previous = saved;
    } catch { /* In-memory comparison also works when storage is unavailable. */ }
    const ids = catalog.models.map(model => model.id);
    const additions = previous ? catalog.models.filter(model => !previous!.includes(model.id)) : [];
    seen.current.set(key, ids);
    try { localStorage.setItem(key,JSON.stringify(ids)); } catch { /* Private profiles keep the in-memory list. */ }
    recent.current = Date.now();
    if (additions.length) notify('새 모델을 사용할 수 있습니다. ' + additions.map(modelDisplayName).join(' / '));
  }, [notify,setModels]);

  const refresh = useCallback(async (force = false) => {
    if (!active || !api?.listAvailableModels || flight.current || !force && Date.now()-recent.current<30_000) return;
    const epoch = generation.current;
    flight.current = true; recent.current=Date.now();
    try {
      const response=await api.listAvailableModels();
      if (epoch === generation.current) accept(response);
    } catch { /* A temporary offline state leaves the last usable list in place. */ }
    finally { flight.current=false; }
  }, [active,api,accept]);
  useEffect(() => {
    generation.current++;
    if (!active) return;
    void refresh();
    const foreground = () => { if(document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(foreground,refreshInterval);
    window.addEventListener('focus',foreground);
    document.addEventListener('visibilitychange',foreground);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener('focus',foreground);
      document.removeEventListener('visibilitychange',foreground);
    };
  },[active,refresh]);
  return {accept,refresh};
}
