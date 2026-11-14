// The DOM: crosshair, health, ammo, timer, score, killfeed, banners, the buy
// menu and the overlays. Every setter caches its last value and only touches
// the DOM when something changed. The buy menu's buttons carry data-buy keys;
// number keys are handled by main.js, which owns the game state.
export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthFill: $('health-fill'),
    healthText: $('health-text'),
    armorText: $('armor-text'),
    helmetBadge: $('helmet-badge'),
    kitBadge: $('kit-badge'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    money: $('money'),
    grenades: $('grenades'),
    timer: $('timer'),
    scoreK: $('score-k'),
    scoreW: $('score-w'),
    roundLabel: $('round-label'),
    aliveK: $('alive-k'),
    aliveW: $('alive-w'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bombBox: $('bomb-status'),
    bombText: $('bomb-text'),
    bombBar: $('bomb-bar'),
    channelBox: $('channel'),
    channelLabel: $('channel-label'),
    channelFill: $('channel-fill'),
    mates: $('mates'),
    vignette: $('vignette'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    playBtn: $('play'),
    teamPick: $('team-pick'),
    keysList: $('keys-list'),
    buyMenu: $('buy-menu'),
    buyMoney: $('buy-money'),
    spectate: $('spectate'),
    hint: $('hint'),
    flash: $('flash'),
    scores: $('scores'),
    scoresBody: $('scores-body'),
  };
  const cache = {};
  let bannerTimer = null;
  let hintTimer = null;
  let hitTimer = null;

  function set(id, value) {
    if (cache[id] === value) return;
    cache[id] = value;
    const el = els[id];
    if (el) el.textContent = value;
  }
  function setHtml(id, value) {
    if (cache[id] === value) return;
    cache[id] = value;
    const el = els[id];
    if (el) el.innerHTML = value;
  }

  els.playBtn.addEventListener('click', () => callbacks.onPlay());
  els.teamPick.querySelectorAll('[data-team]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onPlay(Number(btn.getAttribute('data-team'))));
  });
  els.buyMenu.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onBuy(btn.getAttribute('data-buy')));
  });

  function showOverlay(kind, data) {
    els.overlay.hidden = false;
    // The start screen offers the team choice; every other overlay keeps the
    // single play button.
    const picking = kind === 'start';
    els.teamPick.hidden = !picking;
    els.playBtn.hidden = picking;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'Kestrel Line';
      els.overlayCopy.textContent = 'Halcyon Depot, dusk. Two teams of five fight over two bomb sites: the Kestrels plant the charge at Site A or B, the Wardens stop them or take it apart. First to five rounds takes the match.';
      els.keysList.hidden = false;
    } else if (kind === 'pause') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = `Round ${data.round} — Kestrels ${data.wins[0]} : ${data.wins[1]} Wardens`;
      els.playBtn.textContent = 'Resume';
      els.keysList.hidden = true;
    } else if (kind === 'dead') {
      els.overlayTitle.textContent = 'You are down';
      els.overlayCopy.textContent = 'Spectating a teammate until the round ends.';
      els.playBtn.textContent = 'Spectate';
      els.keysList.hidden = true;
    } else if (kind === 'match') {
      els.overlayTitle.textContent = data.winner === 0 ? 'Kestrels take the match' : 'Wardens take the match';
      els.overlayCopy.textContent = `Final score ${data.wins[0]} — ${data.wins[1]}. ${data.kills} eliminations, ${data.deaths} deaths.`;
      els.playBtn.textContent = 'Play again';
      els.keysList.hidden = true;
    }
  }

  return {
    setAmmo(mag, reserve, reloading) {
      set('ammoMag', String(mag));
      set('ammoReserve', `/ ${reserve}`);
      const cls = mag === 0 ? 'empty' : reloading ? 'reloading' : '';
      if (cache.ammoCls !== cls) {
        cache.ammoCls = cls;
        els.ammoBox.className = cls;
      }
    },
    setWeapon(name) {
      set('weaponName', name);
    },
    setHealth(hp, armor, helmet, kit) {
      set('healthText', String(Math.max(0, hp)));
      const w = `${Math.max(0, hp)}%`;
      if (cache.hpW !== w) {
        cache.hpW = w;
        els.healthFill.style.width = w;
        els.healthFill.className = hp <= 25 ? 'low' : '';
      }
      set('armorText', armor ? 'ARMOR 100' : 'ARMOR 0');
      els.helmetBadge.hidden = !helmet;
      els.kitBadge.hidden = !kit;
    },
    setMoney(m) {
      set('money', `$${m}`);
      set('buyMoney', `$${m}`);
    },
    setGrenades(frag, smoke, flash) {
      const parts = [];
      if (frag > 0) parts.push(`FRAG ${frag}`);
      if (smoke > 0) parts.push(`SMOKE ${smoke}`);
      if (flash > 0) parts.push(`FLASH ${flash}`);
      set('grenades', parts.length > 0 ? parts.join(' · ') : 'No grenades');
    },
    setTimer(text, urgent) {
      set('timer', text);
      const cls = urgent ? 'urgent' : '';
      if (cache.timerCls !== cls) {
        cache.timerCls = cls;
        els.timer.className = cls;
      }
    },
    setScore(k, w, round) {
      set('scoreK', String(k));
      set('scoreW', String(w));
      set('roundLabel', `ROUND ${round}`);
    },
    setAlive(k, w) {
      set('aliveK', '●'.repeat(k) + '○'.repeat(Math.max(0, 5 - k)));
      set('aliveW', '●'.repeat(w) + '○'.repeat(Math.max(0, 5 - w)));
    },
    setSpread(px) {
      const v = `${Math.round(px)}px`;
      if (cache.spread !== v) {
        cache.spread = v;
        els.crosshair.style.setProperty('--gap', v);
      }
    },
    hitmarker(kill, head) {
      els.hitmarker.className = kill ? 'on kill' : head ? 'on head' : 'on';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => { els.hitmarker.className = ''; }, kill ? 220 : 120);
    },
    killfeed(killer, victim, head, killerTeam, weapon) {
      const row = document.createElement('div');
      row.className = killerTeam === 0 ? 'kf k' : 'kf w';
      const a = document.createElement('b');
      a.textContent = killer;
      const mid = document.createElement('span');
      mid.textContent = weapon ? `  [${weapon}${head ? ' xHS' : ''}]  ` : head ? '  ⌖  ' : '  →  ';
      const b = document.createElement('b');
      b.textContent = victim;
      row.append(a, mid, b);
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 5000);
    },
    banner(title, sub, ms) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      if (ms) bannerTimer = setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    hideBanner() {
      els.banner.hidden = true;
    },
    setBomb(text, frac) {
      if (text) {
        els.bombBox.hidden = false;
        set('bombText', text);
        els.bombBar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
      } else {
        els.bombBox.hidden = true;
      }
    },
    setChannel(kind, frac) {
      if (kind) {
        els.channelBox.hidden = false;
        els.channelLabel.textContent = kind === 'plant' ? 'PLANTING CHARGE' : 'DEFUSING CHARGE';
        els.channelFill.style.width = `${Math.round(frac * 100)}%`;
      } else {
        els.channelBox.hidden = true;
      }
    },
    setTeammates(list) {
      const html = list.map((m) => {
        const pct = Math.max(0, m.hp);
        const cls = m.alive ? '' : ' dead';
        const tag = m.isPlayer ? 'YOU' : m.name.toUpperCase();
        return `<div class="mate${cls}"><span>${tag}</span><i><b style="width:${pct}%"></b></i><em>${m.alive ? pct : 'DOWN'}</em></div>`;
      }).join('');
      setHtml('mates', html);
    },
    setSpectating(name) {
      if (name) {
        els.spectate.hidden = false;
        els.spectate.textContent = `Spectating ${name}`;
      } else {
        els.spectate.hidden = true;
      }
    },
    damageFlash() {
      els.vignette.classList.remove('hit');
      void els.vignette.offsetWidth;
      els.vignette.classList.add('hit');
      clearTimeout(cache.vigTimer);
      cache.vigTimer = setTimeout(() => els.vignette.classList.remove('hit'), 350);
    },
    showBuy(show) {
      els.buyMenu.hidden = !show;
    },
    refreshBuy(money, player) {
      els.buyMenu.querySelectorAll('[data-buy]').forEach((btn) => {
        const key = btn.getAttribute('data-buy');
        const price = Number(btn.getAttribute('data-price'));
        let ownedAlready;
        if (key === 'armor') ownedAlready = player.armor;
        else if (key === 'helmet') ownedAlready = player.helmet;
        else if (key === 'kit') ownedAlready = player.kit;
        else if (key === 'grenade') ownedAlready = player.grenades >= 2;
        else if (key === 'smoke') ownedAlready = player.smoke >= 2;
        else if (key === 'flash') ownedAlready = player.flashes >= 2;
        else ownedAlready = !!player.owned[key];
        btn.disabled = ownedAlready || money < price;
        btn.classList.toggle('owned', ownedAlready);
      });
    },
    setFlash(amount) {
      const v = Math.max(0, Math.min(1, amount));
      if (cache.flash !== v) {
        cache.flash = v;
        els.flash.style.opacity = String(v);
      }
    },
    showScores(show) {
      els.scores.hidden = !show;
    },
    setScores(rows) {
      const html = rows.map((r) => {
        const cls = r.team === 0 ? 'k' : 'w';
        const dead = r.alive ? '' : ' dead';
        return `<tr class="${cls}${dead}"><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.money}</td></tr>`;
      }).join('');
      setHtml('scoresBody', html);
    },
    hint(text, ms) {
      els.hint.textContent = text;
      els.hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { els.hint.hidden = true; }, ms || 3500);
    },
    showOverlay,
    hideOverlay() {
      els.overlay.hidden = true;
    },
    get overlayVisible() {
      return !els.overlay.hidden;
    },
  };
}
