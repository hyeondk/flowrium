// Keep the source's item order, including tool events with equal or reconstructed
// timestamps. Only the locally retained entries need a place in that sequence.
export function interleaveLocalMessages(source, local) {
  if (!local.length) return source;
  const entries = local.map(message => ({message, time: Date.parse(message.createdAt)}));
  entries.sort((left, right) => left.time - right.time);
  const result = [];
  let index = 0;
  for (const message of source) {
    const time = Date.parse(message.createdAt);
    while (index < entries.length && entries[index].time < time) {
      result.push(entries[index++].message);
    }
    result.push(message);
  }
  while (index < entries.length) result.push(entries[index++].message);
  return result;
}

export function withLiveTurn(messages, turnId, rows) {
  const source = [], local = [];
  let turnOffset;
  for (const message of messages) {
    if(message.provider==='claude')local.push(message);
    else if (message.turnId === turnId) {
      turnOffset ??= source.length;
    } else if (message.turnId) source.push(message);
    else local.push(message);
  }
  turnOffset ??= source.length;
  const updated = source.slice(0, turnOffset).concat(rows, source.slice(turnOffset));
  return interleaveLocalMessages(updated, local);
}
