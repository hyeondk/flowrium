import {projectCategory} from "../shared/project-details";
import {useEffect, useRef, useState} from 'react';
import type {Project} from '../shared/types';
import ChoicePicker from './ChoicePicker';
import ProjectCategoryLabel from './ProjectCategoryLabel';
import {useDebouncedSetting} from './useDebouncedSetting';

interface Props {
  projects: Project[];
  categories: Record<string, string>;
  initialProject?: string;
  onSaved(id: string, category: string): void;
}

function CategoryForm({project, current, options, onSaved}: {
  project: Project;
  current: string;
  options: string[];
  onSaved: Props['onSaved'];
}) {
  const [value, setValue] = useState(current);
  const [message, setMessage] = useState('');
  const persisted = useRef(current);
  const pending = useRef<{category: string} | undefined>(undefined);
  const latestInput = useRef(current);
  const writes = useRef(Promise.resolve());
  const {schedule, cancel} = useDebouncedSetting();

  useEffect(() => {
    if (!pending.current && latestInput.current === persisted.current) {
      latestInput.current = current;
      setValue(current);
      persisted.current = current;
    }
  }, [current]);

  function commit(text: string) {
    cancel();
    const category = text.trim();
    const api = window.flowrium;
    if (!api || category === (pending.current?.category ?? persisted.current)) return;
    const write = {category};
    pending.current = write;
    writes.current = writes.current.then(async () => {
      try {
        const latest = await api.readProjectDetails(project.id);
        const external = projectCategory(latest) || '';
        if (external !== persisted.current) {
          persisted.current = external;
          onSaved(project.id, external);
          setMessage('다른 창에서 바꾼 카테고리가 있습니다. 확인 후 다시 입력해 주세요.');
          return;
        }
        const next = await api.updateProjectDetails(project.id, latest.revision, {action: 'category', category});
        const saved = projectCategory(next) || '';
        persisted.current = saved;
        onSaved(project.id, saved);
        if (pending.current === write) setMessage('자동 저장했습니다.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '카테고리를 저장할 수 없습니다.');
      } finally {
        if (pending.current === write) pending.current = undefined;
      }
    });
  }

  function change(text: string, composing = false) {
    latestInput.current = text;
    setValue(text);
    setMessage('');
    cancel();
    if (!composing && text.trim()) schedule(() => commit(text));
  }

  return <div className="category-edit-form">
    <div className="category-choice-field"><span>카테고리 이름</span>
      <ChoicePicker label="카테고리 이름" editable maxLength={80} value={value}
        options={options.map(name=>({value:name,label:name}))}
        onChange={change} onCommit={commit} placeholder="미분류"/>
    </div>
    {message && <small role="status">{message}</small>}
  </div>;
}

export function ProjectCategorySettings({projects,categories,initialProject,onSaved}: Props) {
  const [projectId,setProjectId] = useState(initialProject);
  const project = projects.find(item => item.id === projectId) || projects[0];
  const options = [...new Set(['개인','업무',...Object.values(categories).filter(Boolean)])];
  return <section className="settings-section category-settings" aria-label="프로젝트 카테고리 관리">
    <h3>카테고리 관리</h3>
    {project ? <>
      <div className="category-choice-field"><span>프로젝트</span>
        <ChoicePicker label="프로젝트" value={project.id} onChange={setProjectId}
          options={projects.map(item=>({value:item.id,label:item.name,leading:<ProjectCategoryLabel category={categories[item.id]}/>}))}/>
      </div>
      <CategoryForm key={project.id} current={categories[project.id] || ''} project={project} options={options} onSaved={onSaved}/>
      <small>기존 이름을 선택하거나 새로 입력하세요. 비워 두면 미분류로 저장됩니다.</small>
    </> : <p>등록한 프로젝트가 없습니다.</p>}
  </section>;
}
