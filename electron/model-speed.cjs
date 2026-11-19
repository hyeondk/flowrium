const tiers = {standard: 'default', fast: 'priority', ultrafast: 'ultrafast'};

function serviceTier(speed) {
  if (speed === undefined) return undefined;
  if (typeof speed !== 'string' || !Object.hasOwn(tiers, speed))
    throw Error('실행 속도를 확인해 주세요.');
  return tiers[speed];
}

function supportedSpeeds(model) {
  if (!model || !Array.isArray(model.serviceTiers) && !Array.isArray(model.additionalSpeedTiers)) return undefined;
  const advertised = Array.isArray(model.serviceTiers) ? model.serviceTiers : [];
  const legacy = Array.isArray(model.additionalSpeedTiers) ? model.additionalSpeedTiers : [];
  const values = advertised.length ? advertised.map(tier => tier?.id) : legacy;
  return ['standard',
    ...(values.some(tier => tier === 'priority' || tier === 'fast') ? ['fast'] : []),
    ...(values.includes('ultrafast') ? ['ultrafast'] : []),
  ];
}

function supportedTier(tier, model) {
  const supported = supportedSpeeds(model);
  return supported && tier && !supported.some(speed => serviceTier(speed) === tier) ? 'default' : tier;
}

module.exports = {serviceTier, supportedSpeeds, supportedTier};
