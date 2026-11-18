export default function LoadingProgress({label, startup = false}: {label: string; startup?: boolean}) {
  return <div className={startup ? 'flow-loading flow-loading-startup' : 'flow-loading'} role="status">
    {startup && <img src="./flowrium.png" width="40" height="40" alt="Flowrium" />}
    <span>{label}</span>
    <span className="flow-loading-track" role="progressbar" aria-label={label} />
  </div>;
}
