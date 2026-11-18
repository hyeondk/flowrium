import {Tag} from 'lucide-react';
import './project-category-label.css';

export default function ProjectCategoryLabel({category,className=''}:{category?:string;className?:string}){
 return <span className={'project-category-label'+(className?' '+className:'')}><Tag size={12} aria-hidden="true"/><span>{category?.trim()||'미분류'}</span></span>;
}
