const svgNamespace = 'http://www.w3.org/2000/svg';

const iconPaths = {
  refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  circle: 'M20 12a8 8 0 1 1-16 0 8 8 0 1 1 16 0Z',
  x: 'm6 6 12 12M18 6 6 18',
  qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3m0 4v3H3m9 5v3m3-9h6v3',
};

export function addActionIcon(button, icon) {
  if (!Object.hasOwn(iconPaths, icon)) return button;

  const document = button.ownerDocument;
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'mobile-action-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(svgNamespace, 'path');
  path.setAttribute('d', iconPaths[icon]);
  svg.append(path);

  const previous = button.querySelector(':scope > .mobile-action-icon');
  if (previous) previous.replaceWith(svg);
  else button.prepend(svg);
  return button;
}

export function emphasizeAction(button, icon) {
  addActionIcon(button, icon);
  button.classList.add('mobile-emphasized-action');
  return button;
}
