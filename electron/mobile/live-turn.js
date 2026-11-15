export function withLiveTurn(messages, turnId, rows) {
  const at=messages.findIndex(message=>message.turnId===turnId);
  if(at<0)return [...messages,...rows];
  return [...messages.slice(0,at),...rows,...messages.slice(at).filter(message=>message.turnId!==turnId)];
}
