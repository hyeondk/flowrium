import {projectCategory} from "../shared/project-details";
import {useEffect, useState, type FormEvent} from 'react';
import type {Project} from '../shared/types';
import ChoicePicker from './ChoicePicker';
import ProjectCategoryLabel from './ProjectCategoryLabel';

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
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(current), [current]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !window.flowrium) return;
    setBusy(true);
    setMessage('');
    try {
      const latest = await window.flowrium.readProjectDetails(project.id);
      if ((projectCategory(latest) || '') !== current) {
        onSaved(project.id, projectCategory(latest) || '');
        setMessage('다른 창에서 변경한 카테고리를 확인한 뒤 다시 저장하세요.');
        return;
      }
      const next = await window.flowrium.updateProjectDetails(project.id, latest.revision, {
        action: 'category', category: value.trim(),
      });
      onSaved(project.id, projectCategory(next) || '');
      setMessage('저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '카테고리를 저장할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }
  return <form className="category-edit-form" onSubmit={save}>
    <div className="category-choice-field"><span>카테고리 이름</span>
      <ChoicePicker label="카테고리 이름" editable disabled={busy} maxLength={80} value={value}
        options={options.map(name=>({value:name,label:name}))}
        onChange={text=>{setValue(text);setMessage('');}} placeholder="미분류"/>
    </div>
    <button className="button primary" disabled={busy || value.trim() === current}>저장</button>
    {message && <small role="status">{message}</small>}
  </form>;
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
