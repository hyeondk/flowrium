import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { errorText } from "./ProjectPortfolio";

export default function WeeklyReportFile({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const [report, setReport] = useState<{ name: string; expiresAt: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    window.flowrium?.readWeeklyReportFile(sessionId, messageId).then(file => {
      if (live) setReport(file);
    }).catch(() => {});
    return () => { live = false; };
  }, [sessionId, messageId]);

  useEffect(() => {
    if (!report) return;
    const timeout = window.setTimeout(() => setReport(null), Math.max(0, Date.parse(report.expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [report]);

  async function save() {
    if (!report || !window.flowrium || saving) return;
    setSaving(true);
    setError("");
    try {
      if (await window.flowrium.saveWeeklyReportFile(sessionId, messageId)) {
        setSaved(true);
        setReport(null);
      }
    } catch (failure) { setError(errorText(failure)); }
    finally { setSaving(false); }
  }

  if (saved) return <p className="weekly-report-file-status" role="status">엑셀 보고서를 저장했습니다.</p>;
  if (!report) return null;
  const deadline = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(report.expiresAt));
  return <div className="weekly-report-file">
    <FileSpreadsheet size={19} aria-hidden="true"/>
    <div><strong>{report.name}</strong><small>{deadline}까지 보관</small></div>
    <button className="button secondary" disabled={saving} type="button" onClick={() => void save()}>
      <Download size={15} aria-hidden="true"/>{saving ? "저장 위치 선택 중" : "엑셀 저장"}
    </button>
    {error && <p className="weekly-report-file-error" role="alert">{error}</p>}
  </div>;
}
