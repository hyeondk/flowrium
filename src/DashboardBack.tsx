import {ArrowLeft} from 'lucide-react';

export default function DashboardBack({onClick}: {onClick(): void}) {
  return <button type="button" className="dashboard-back" aria-label="대시보드로 돌아가기" onClick={onClick}>
    <ArrowLeft size={14} aria-hidden="true"/><span>Home</span>
  </button>;
}
