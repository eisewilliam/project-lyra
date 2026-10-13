// Documentation renderer only. Values are illustrative and never call Tauri.
const params = new URLSearchParams(location.search);
const scale = params.get('scale') === '2' ? 2 : 1;
document.documentElement.style.setProperty('--render-scale', scale);
const pages = [
  ['general', 'General', 'sliders-horizontal'],
  ['appearance', 'Appearance', 'swatches'],
  ['players', 'Players', 'headphones'],
  ['main', 'Main Window', 'app-window'],
  ['island', 'Marquee', 'picture-in-picture'],
  ['karaoke', 'Karaoke', 'subtitles'],
];
const section = pages.some(([id]) => id === params.get('section')) ? params.get('section') : 'appearance';
const title = pages.find(([id]) => id === section)[1];
document.title = `Lyra ${title} design reference`;
document.getElementById('page-title').textContent = title;
document.getElementById('pane-body').classList.add(section);
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const nav = (items) => items.map(([id, label, icon]) => `<a class="nav-item ${id === section ? 'active' : ''}" ${id === section ? 'aria-current="page"' : ''} href="?section=${id}&scale=${scale}"><img src="assets/${icon}.svg" alt=""><span>${label}</span></a>`).join('');
document.getElementById('navigation').innerHTML = `<div class="nav-group">${nav(pages.slice(0,3))}</div><div class="nav-group"><div class="nav-caption">Surfaces</div>${nav(pages.slice(3))}</div>`;

const select = (label, options, value, wide = false) => `<select aria-label="${escape(label)}" class="${wide ? 'wide' : ''}">${options.map(option => `<option ${option === value ? 'selected' : ''}>${escape(option)}</option>`).join('')}</select>`;
const toggle = (label, on, disabled = false) => `<input class="toggle" type="checkbox" role="switch" aria-label="${escape(label)}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`;
const button = (label, quiet = false) => `<button class="${quiet ? 'quiet-button' : ''}" type="button">${label}</button>`;
const segments = (label, options, selected, long = false) => `<div class="segmented ${long ? 'long' : ''}" role="group" aria-label="${escape(label)}">${options.map(option => `<button type="button" aria-pressed="${option === selected}" class="${option === selected ? 'selected' : ''}">${option}</button>`).join('')}</div>`;
const slider = (label, values, index, secondary = '') => `<div class="slider-control"><div class="slider-stack"><input class="range" type="range" aria-label="${escape(label)}" aria-valuetext="${escape(values[index])}" min="0" max="${values.length-1}" step="1" value="${index}" style="--progress:${index/(values.length-1)*100}%" data-values='${escape(JSON.stringify(values))}'><div class="ticks" aria-hidden="true">${values.map(() => '<span class="tick"></span>').join('')}</div></div><output class="value">${values[index]}${secondary ? `<small>${secondary}</small>` : ''}</output></div>`;
const row = (label, control, hint = '', disabled = false) => `<div class="row ${hint ? 'has-hint' : ''} ${disabled ? 'disabled' : ''}"><div class="label">${label}${hint ? `<p class="hint">${hint}</p>` : ''}</div><div class="control">${control}</div></div>`;
const group = (label, content) => `<section class="group"><h2>${label}</h2>${content}</section>`;
const preview = (kind = 'main') => {
  const line = '<div class="preview-line active">Every word lands <span class="unsung">right on time</span></div>';
  if (kind === 'island') return `<div class="preview-label">Live preview</div><div class="preview marquee-preview"><div class="marquee-panel"><img src="assets/cover.jpg" alt=""><div>${line}<div class="preview-line">And the next line waits in view</div></div></div></div>`;
  if (kind === 'karaoke') return `<div class="preview-label">Live preview</div><div class="preview karaoke-preview"><div class="karaoke-band">${line}<div class="preview-line">And the next line waits in view</div></div></div>`;
  return `<div class="appearance-preview"><div class="preview-label">Live preview</div><div class="preview"><div class="preview-line">City lights are humming low</div>${line}<div class="preview-line">And the next line waits in view</div></div></div>`;
};
let body = '';
if (section === 'appearance') {
  body = preview() + row('Theme', select('Theme', ['System', 'Light', 'Dark'], 'Dark'), '', false).replace('class="row ', 'class="row theme-row ')
    + group('Typography', row('Font', select('Font', ['System Default', 'SF Pro Rounded', 'Inter', 'Monospace'], 'System Default'))
      + row('Text size', slider('Text size', ['12 px','14 px','16 px','18 px','20 px','24 px'], 2, 'Medium'))
      + row('Lyric color', '<input class="color-well" type="color" value="#ffffff" aria-label="Lyric color">'))
    + group('Background', row('Background darkness', slider('Background darkness', ['0%','25%','50%','75%','100%'], 3), 'Main Window and Marquee.')
      + row('Lyric blur', segments('Lyric blur', ['Off','Subtle','Standard','Strong'], 'Standard', true), 'Softens surrounding lines.'));
}
if (section === 'general') {
  body = group('System', row('Battery saver', toggle('Battery saver', false), 'Checks the player once a second and lightens blur effects.')
    + row('Hide when paused', toggle('Hide when paused', false), 'Hides every Lyra window while playback is paused.')
    + row('Launch at login', toggle('Launch at login', true)))
    + group('Storage', row('Lyrics cache', button('Clear cache'), 'Cleared lyrics download again when each song plays.'));
  if (params.get('hardware') === '1') {
    body += group('Display', row('Show on screen', select('Show on screen', ['Primary (default)','Built-in Display (2560×1600) — Primary','External Display (3840×2160)'], 'Primary (default)', true)))
      + group('Touch Bar', row('Show Lyra in the Control Strip', toggle('Show Lyra in the Control Strip', false), 'Tap it to show lyrics over any app.'));
  }
  body += group('Updates', row('Lyra 0.1.0', button('Check now'), 'Lyra checks for updates automatically.'));
}
if (section === 'players') {
  const player = (name, icon, note, controls) => `<div class="player-row"><img src="assets/${icon}.svg" alt=""><div class="player-copy"><div class="player-title">${name}</div><p class="hint">${note}</p></div>${controls}</div>`;
  body = group('Following', row('Player', select('Player', ['Whichever is playing','Only Spotify','Only Apple Music'], 'Whichever is playing', true))
    + row('Only follow music', toggle('Only follow music', true))
    + row('Lyrics for browser media', select('Lyrics for browser media', ['Ask','Look up lyrics',"Don’t look up"], 'Ask'), 'Asks before using a browser title and artist to find lyrics.'))
    + group('Now playing', player('Spotify', 'spotify', 'Midnight Signals · Demo artist', '<span class="player-status">Following</span><button class="disclosure-button" aria-label="Show Spotify details" aria-expanded="false"><img src="assets/disclosure.svg" alt=""></button>')
      + '<div class="session-details" hidden>Synced to the player<br>Controls: Play and pause, skip and seek<br><button class="quiet-button" type="button">Not music</button></div>')
    + group('Remembered players', player('Spotify', 'spotify', 'Running now', select('When Spotify plays',['Music only','Always follow','Never follow'],'Music only')+button('Forget',true))
      + player('Apple Music', 'apple-music', 'Last used earlier today', select('When Apple Music plays',['Music only','Always follow','Never follow'],'Music only')+button('Forget',true)));
}
if (section === 'main') {
  body = group('Visibility', row('Show Main Window', toggle('Show Main Window', true))
    + row('Show over full-screen apps', toggle('Show over full-screen apps', false))
    + row('Hide when nothing is playing', toggle('Hide when nothing is playing', true)))
    + group('Window', row('Keep window on top', toggle('Keep window on top', true), 'Not while the window is maximized or full screen.')
      + row('Click-through', toggle('Click-through', false), 'Clicks pass to the window behind Lyra.'))
    + group('Lyrics', row('Focus on current line', toggle('Focus on current line', false), 'Shows only the current and next line, centered.')
      + row('Text scale', slider('Text scale',['75%','Normal','125%','150%','200%'],1), 'Relative to Text size in Appearance.'));
}
if (section === 'island') {
  document.getElementById('pinned-preview').innerHTML = preview('island');
  body = group('Visibility', row('Show Marquee', toggle('Show Marquee', true), 'A dynamic panel above your other windows.')
    + row('Show over full-screen apps', toggle('Show over full-screen apps', false)))
    + group('Window', row('Lock position', toggle('Lock position', false), 'Unlock to drag the Marquee anywhere.')
      + row('Click-through', toggle('Click-through', false), 'Clicks pass through and Marquee controls turn off.')
      + row('Position', button('Reset position')))
    + group('Layout', row('Size', select('Size',['Match screen','Small','Medium','Large','Extra large'],'Match screen'), 'Match screen picks a size for each display.')
      + row('Width', slider('Width',['Narrow','Standard','Wide','Widest'],1))
      + row('Lines', segments('Lines',['Current only','Current and next'],'Current and next'))
      + row('Text scale', slider('Text scale',['75%','Normal','125%','150%','200%'],1), 'Relative to Text size in Appearance.'))
    + group('Background', row('Transparency', slider('Transparency',['Solid','Low','Standard','High','Clear'],2), 'Lyrics keep their contrast at every level.'))
    + group('Cover art', row('Show cover art', toggle('Show cover art', true))
      + row('Circular', toggle('Circular', false))
      + row('Spin while playing', toggle('Spin while playing', false)));
}
if (section === 'karaoke') {
  document.getElementById('pinned-preview').innerHTML = preview('karaoke');
  body = group('Visibility', row('Show Karaoke Lyrics', toggle('Show Karaoke Lyrics', true))
    + row('Show over full-screen apps', toggle('Show over full-screen apps', false)))
    + group('Layout', row('Position', segments('Position',['Top','Bottom'],'Bottom'))
      + row('Distance from edge', slider('Distance from edge',['None','Small','Medium','Large','Extra','Max'],2))
      + row('Width', slider('Width',['50%','60%','70%','80%','90%','100%'],3)))
    + group('Text', row('Text scale', slider('Text scale',['75%','Normal','125%','150%','200%'],1), 'Relative to Text size in Appearance.')
      + row('Alignment', segments('Alignment',['Left','Center','Right'],'Center'))
      + row('Lines', segments('Lines',['Current only','Current and next'],'Current and next'))
      + row('Bold lyrics', toggle('Bold lyrics', true))
      + row('Shade behind lyrics', slider('Shade behind lyrics',['None','25%','50%','75%'],1)));
}
document.getElementById('pane-body').innerHTML = body;
document.querySelectorAll('.range').forEach(input => input.addEventListener('input', () => {
  const values = JSON.parse(input.dataset.values);
  const value = values[Number(input.value)];
  input.style.setProperty('--progress', `${Number(input.value)/(values.length-1)*100}%`);
  input.setAttribute('aria-valuetext',value);
  input.closest('.slider-control').querySelector('output').textContent = value;
}));
document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => {
    item.classList.toggle('selected',item === button);
    item.setAttribute('aria-pressed',String(item === button));
  });
}));
document.querySelector('.disclosure-button')?.addEventListener('click', (event) => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
  document.querySelector('.session-details').hidden = !expanded;
});
if (params.get('scroll')) requestAnimationFrame(() => {
  const pane = document.getElementById('pane-body');
  if (params.get('scroll') === 'end') pane.scrollTop = pane.scrollHeight;
  if (params.get('scroll') === 'layout') {
    const layout = [...pane.querySelectorAll('.group')].find(group => group.querySelector('h2')?.textContent === 'Layout');
    if (layout) pane.scrollTop = layout.offsetTop - pane.offsetTop;
  }
});
