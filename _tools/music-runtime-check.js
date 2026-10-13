(() => {
  const fs = require('fs');
  const root = 'D:/Project/JamDeck';
  const plugin = app.plugins.plugins['jam-deck'];
  const players = [...document.querySelectorAll('.jam-deck-music-player')];
  const result = { version: plugin.manifest.version, players: players.map(player => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const controls = player.querySelector('.jam-deck-music-controls'), timeline = player.querySelector('.jam-deck-music-timeline');
    return { bounds:rect(player), hero:rect(player.querySelector('.jam-deck-music-hero')), meta:rect(player.querySelector('.jam-deck-music-meta')), timeline:rect(timeline), controls:rect(controls), visible:getComputedStyle(controls).visibility, position:getComputedStyle(controls).position, controlsInDetails:!!controls.closest('.jam-deck-music-details'), bodyOverflow:player.parentElement.scrollWidth > player.parentElement.clientWidth };
  }) };
  fs.writeFileSync(root + '/_reports/music-runtime.json', JSON.stringify(result, null, 2));
  const player = players.find(el => el.getBoundingClientRect().width > 0);
  if (player) {
    const r = player.closest('.jam-deck-widget').getBoundingClientRect();
    const wc = require('electron').remote.getCurrentWebContents();
    wc.capturePage({ x:Math.max(0, Math.floor(r.x)), y:Math.max(0, Math.floor(r.y)), width:Math.ceil(r.width), height:Math.ceil(r.height) }).then(image => fs.writeFileSync(root + '/_screenshots/music-runtime.png', image.toPNG()));
  }
  return JSON.stringify(result);
})();
