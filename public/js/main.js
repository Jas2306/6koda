/**
 * 6KODA - Client
 */

let socket, myId, myName, roomCode, isHost = false, gameState = null, selectedCards = [];

const screens = {
  menu: document.getElementById('menuScreen'),
  lobby: document.getElementById('lobbyScreen'),
  game: document.getElementById('gameScreen'),
  leaderboard: document.getElementById('leaderboardScreen')
};

// ==================== UTILS ====================

function showScreen(name) {
  Object.values(screens).forEach(s => s?.classList.add('hidden'));
  screens[name]?.classList.remove('hidden');
}

function showToast(msg, type = '', duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function addLog(msg) {
  const log = document.getElementById('gameLog');
  if (!log) return;
  const e = document.createElement('div');
  e.className = 'log-entry';
  e.textContent = msg;
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 30) log.removeChild(log.firstChild);
}

function getSuit(s) {
  return { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }[s] || '?';
}

function getBadge(v) {
  return { '2': '⭐', '3': '👻', '7': '⬇️', '10': '🔥' }[v] || '';
}

function confetti() {
  const colors = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];
  for (let i = 0; i < 50; i++) {
    setTimeout(() => {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3500);
    }, i * 40);
  }
}

// ==================== CARDS ====================

function createCard(card, faceDown = false, mini = false) {
  const d = document.createElement('div');
  const sz = mini ? 'mini' : '';
  
  if (faceDown || !card) {
    d.className = `card back ${sz}`;
    d.innerHTML = '?';
  } else {
    const sp = ['2','3','7','10'].includes(card.value) ? `special-${card.value}` : '';
    d.className = `card front ${card.suit} ${sp} ${sz}`;
    d.innerHTML = `
      <span class="value">${card.value}</span>
      <span class="suit">${getSuit(card.suit)}</span>
      ${getBadge(card.value) ? `<span class="badge">${getBadge(card.value)}</span>` : ''}
    `;
    d.dataset.cardId = card.id;
  }
  return d;
}

// ==================== RENDER ====================

function render() {
  if (!gameState) return;
  selectedCards = [];
  renderOpponents();
  renderCenter();
  renderStatus();
  renderMyCards();
  updateButtons();
  renderForcedModal();
}

function renderOpponents() {
  const area = document.getElementById('opponentsArea');
  if (!area) return;
  area.innerHTML = '';
  
  (gameState.opponents || []).forEach(o => {
    const d = document.createElement('div');
    d.className = 'opponent';
    if (gameState.currentPlayer === o.id) d.classList.add('current-turn');
    if (o.finished) d.classList.add('finished');
    
    const cards = (o.faceUp || []).map(c => createCard(c, false, true).outerHTML).join('') || '<span class="empty">-</span>';
    d.innerHTML = `
      <div class="opponent-name">${o.name}${o.finished ? ' ✓' : ''}${gameState.currentPlayer === o.id ? ' 🎯' : ''}</div>
      <div class="opponent-cards">${cards}</div>
      <div class="opponent-info">🤚${o.handCount} 🎴${o.faceDownCount}</div>
    `;
    area.appendChild(d);
  });
}

function renderCenter() {
  const dc = document.getElementById('deckCount');
  if (dc) dc.textContent = gameState.deckCount || 0;
  
  const pile = document.getElementById('pile');
  if (pile) {
    pile.innerHTML = '';
    if (gameState.pile?.length) {
      pile.appendChild(createCard(gameState.pile[gameState.pile.length - 1]));
    }
  }
  
  const pc = document.getElementById('pileCount');
  if (pc) pc.textContent = `(${gameState.pileCount || 0})`;
  
  const deck = document.getElementById('deckArea');
  if (deck) {
    const canDraw = gameState.currentPlayer === myId && 
                    gameState.deckCount > 0 && 
                    (gameState.myHand?.length || 0) > 0 && 
                    !gameState.hasForcedCard &&
                    gameState.phase === 'playing';
    deck.classList.toggle('clickable', canDraw);
  }
}

function renderStatus() {
  const ti = document.getElementById('turnIndicator');
  if (!ti) return;
  
  const myTurn = gameState.currentPlayer === myId;
  
  if (gameState.amIFinished) {
    ti.textContent = "You're out! 🎉";
    ti.className = 'waiting';
  } else if (gameState.hasForcedCard) {
    ti.textContent = "Play or decline drawn card!";
    ti.className = 'my-turn';
  } else if (myTurn) {
    ti.textContent = "YOUR TURN!";
    ti.className = 'my-turn';
  } else {
    ti.textContent = `${gameState.currentPlayerName}'s turn`;
    ti.className = 'waiting';
  }
  
  const sw = document.getElementById('sevenWarning');
  if (sw) sw.classList.toggle('hidden', !(gameState.mustPlayLowCard && myTurn));
  
  const ec = document.getElementById('effectiveCard');
  if (ec) {
    const top = gameState.pile?.[gameState.pile.length - 1];
    if (top?.value === '3' && gameState.effectiveTopCard) {
      ec.textContent = `Beat: ${gameState.effectiveTopCard.value}`;
      ec.classList.remove('hidden');
    } else {
      ec.classList.add('hidden');
    }
  }
  
  const ma = document.getElementById('myArea');
  if (ma) ma.classList.toggle('my-turn', myTurn && !gameState.amIFinished);
}

function renderMyCards() {
  const myTurn = gameState.currentPlayer === myId;
  const swapping = gameState.phase === 'swapping';
  const forced = gameState.hasForcedCard;
  
  let source = null;
  if (!gameState.amIFinished && !forced) {
    if (gameState.myHand?.length) source = 'hand';
    else if (gameState.myFaceUp?.length) source = 'faceUp';
    else if (gameState.myFaceDownCount) source = 'faceDown';
  }
  
  // Face down
  const fd = document.getElementById('myFaceDown');
  if (fd) {
    fd.innerHTML = '';
    const cnt = gameState.myFaceDownCount || 0;
    if (!cnt) {
      fd.innerHTML = '<span class="empty">-</span>';
    } else {
      for (let i = 0; i < cnt; i++) {
        const c = createCard(null, true);
        c.dataset.source = 'faceDown';
        c.dataset.index = i;
        if (myTurn && source === 'faceDown') {
          c.onclick = () => toggleSelect(c, i, 'faceDown');
        } else {
          c.style.opacity = '0.5';
          c.style.cursor = 'default';
        }
        fd.appendChild(c);
      }
    }
  }
  
  // Face up
  const fu = document.getElementById('myFaceUp');
  if (fu) {
    fu.innerHTML = '';
    const cards = gameState.myFaceUp || [];
    if (!cards.length) {
      fu.innerHTML = '<span class="empty">-</span>';
    } else {
      cards.forEach((card, i) => {
        const c = createCard(card);
        c.dataset.source = 'faceUp';
        c.dataset.index = i;
        if (swapping || (myTurn && source === 'faceUp')) {
          c.onclick = () => toggleSelect(c, i, 'faceUp');
        } else {
          c.style.opacity = '0.6';
          c.style.cursor = 'default';
        }
        fu.appendChild(c);
      });
    }
  }
  
  // Hand
  const h = document.getElementById('myHand');
  if (h) {
    h.innerHTML = '';
    const cards = gameState.myHand || [];
    if (!cards.length) {
      h.innerHTML = '<span class="empty">-</span>';
    } else {
      cards.forEach((card, i) => {
        const c = createCard(card);
        c.dataset.source = 'hand';
        c.dataset.index = i;
        if (swapping || (myTurn && source === 'hand' && !forced)) {
          c.onclick = () => toggleSelect(c, i, 'hand');
        } else {
          c.style.opacity = '0.6';
          c.style.cursor = 'default';
        }
        h.appendChild(c);
      });
    }
  }
}

function updateButtons() {
  const swap = gameState.phase === 'swapping';
  const myTurn = gameState.currentPlayer === myId;
  const forced = gameState.hasForcedCard;
  const canDraw = myTurn && gameState.deckCount > 0 && (gameState.myHand?.length || 0) > 0 && !forced && gameState.phase === 'playing';
  
  document.getElementById('playBtn')?.classList.toggle('hidden', swap || forced);
  document.getElementById('pickUpBtn')?.classList.toggle('hidden', swap || forced);
  document.getElementById('drawCardBtn')?.classList.toggle('hidden', swap || !canDraw);
  document.getElementById('confirmSwapBtn')?.classList.toggle('hidden', !swap);
}

function renderForcedModal() {
  const modal = document.getElementById('forcedCardModal');
  if (!modal) return;
  
  if (gameState.hasForcedCard && gameState.forcedCard) {
    const display = document.getElementById('forcedCardDisplay');
    if (display) {
      display.innerHTML = '';
      display.appendChild(createCard(gameState.forcedCard));
    }
    
    const status = document.getElementById('forcedCardStatus');
    const playBtn = document.getElementById('playForcedBtn');
    if (status && playBtn) {
      if (gameState.canPlayForcedCard) {
        status.innerHTML = '<span style="color:var(--success)">✓ Can play!</span>';
        playBtn.disabled = false;
      } else {
        status.innerHTML = '<span style="color:var(--danger)">✗ Cannot play</span>';
        playBtn.disabled = true;
      }
    }
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function toggleSelect(el, idx, src) {
  const i = selectedCards.findIndex(c => c.index === idx && c.source === src);
  if (i >= 0) {
    selectedCards.splice(i, 1);
    el.classList.remove('selected');
  } else {
    if (src === 'faceDown') {
      document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
      selectedCards = [];
    }
    selectedCards.push({ index: idx, source: src });
    el.classList.add('selected');
  }
}

function updatePlayerList(players) {
  const list = document.getElementById('playerList');
  if (!list) return;
  list.innerHTML = '';
  
  (players || []).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'player-item';
    if (p.ready) d.classList.add('ready');
    if (i === 0) d.classList.add('host');
    d.innerHTML = `
      <span>${p.name}</span>
      <span class="status">${p.ready ? '✓' : '...'}</span>
    `;
    list.appendChild(d);
  });
}

// ==================== EVENTS ====================

document.getElementById('createRoomBtn')?.addEventListener('click', () => {
  const name = document.getElementById('playerName')?.value.trim();
  if (!name) return showToast('Enter your name!', 'error');
  if (!socket?.connected) return showToast('Not connected', 'error');
  myName = name;
  socket.emit('createRoom', { playerName: name });
});

document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
  const name = document.getElementById('playerName')?.value.trim();
  const code = document.getElementById('roomCodeInput')?.value.trim().toUpperCase();
  if (!name) return showToast('Enter your name!', 'error');
  if (!code || code.length < 4) return showToast('Enter room code!', 'error');
  if (!socket?.connected) return showToast('Not connected', 'error');
  myName = name;
  socket.emit('joinRoom', { playerName: name, roomCode: code });
});

document.getElementById('readyBtn')?.addEventListener('click', () => {
  socket?.emit('playerReady');
  const btn = document.getElementById('readyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ready!'; }
});

document.getElementById('startGameBtn')?.addEventListener('click', () => {
  socket?.emit('startGame');
});

document.getElementById('playBtn')?.addEventListener('click', () => {
  if (!selectedCards.length) return showToast('Select cards!', 'error');
  socket?.emit('playCards', { cardIndices: selectedCards.map(c => c.index) });
  selectedCards = [];
});

document.getElementById('pickUpBtn')?.addEventListener('click', () => {
  socket?.emit('pickUpPile');
});

document.getElementById('drawCardBtn')?.addEventListener('click', () => {
  socket?.emit('pickFromDeck');
});

document.getElementById('confirmSwapBtn')?.addEventListener('click', () => {
  socket?.emit('confirmReady');
  const btn = document.getElementById('confirmSwapBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Waiting...'; }
});

document.getElementById('leaderboardBtn')?.addEventListener('click', () => {
  socket?.emit('getLeaderboard');
});

document.getElementById('backBtn')?.addEventListener('click', () => {
  showScreen('menu');
});

document.getElementById('playAgainBtn')?.addEventListener('click', () => {
  document.getElementById('gameOverModal')?.classList.add('hidden');
  socket?.emit('playAgain');
});

document.getElementById('exitBtn')?.addEventListener('click', () => {
  location.reload();
});

document.getElementById('playForcedBtn')?.addEventListener('click', () => {
  socket?.emit('playForcedCard');
  document.getElementById('forcedCardModal')?.classList.add('hidden');
});

document.getElementById('declineForcedBtn')?.addEventListener('click', () => {
  socket?.emit('declineForcedCard');
  document.getElementById('forcedCardModal')?.classList.add('hidden');
});

document.getElementById('deckArea')?.addEventListener('click', () => {
  if (!gameState) return;
  const canDraw = gameState.currentPlayer === myId && 
                  gameState.deckCount > 0 && 
                  (gameState.myHand?.length || 0) > 0 && 
                  !gameState.hasForcedCard &&
                  gameState.phase === 'playing';
  if (canDraw) socket?.emit('pickFromDeck');
});

// Swap logic
let swapSel = null;
document.addEventListener('click', (e) => {
  if (!gameState || gameState.phase !== 'swapping') return;
  const card = e.target.closest('.card');
  if (!card) return;
  const src = card.dataset.source;
  const idx = parseInt(card.dataset.index);
  if (isNaN(idx)) return;
  
  if (src === 'hand') {
    document.querySelectorAll('#myHand .card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    swapSel = { handIndex: idx };
    showToast('Click face-up card to swap');
  } else if (src === 'faceUp' && swapSel) {
    socket?.emit('swapCards', { handIndex: swapSel.handIndex, faceUpIndex: idx });
    swapSel = null;
    document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
    showToast('Swapped!', 'success');
  }
});

// Enter key
document.getElementById('playerName')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') {
    const code = document.getElementById('roomCodeInput')?.value.trim();
    if (code) document.getElementById('joinRoomBtn')?.click();
    else document.getElementById('createRoomBtn')?.click();
  }
});
document.getElementById('roomCodeInput')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('joinRoomBtn')?.click();
});

// ==================== SOCKET ====================

function initSocket() {
  socket = io({ reconnection: true, reconnectionAttempts: 5 });
  
  socket.on('connect', () => {
    myId = socket.id;
    console.log('Connected:', myId);
  });
  
  socket.on('disconnect', () => showToast('Disconnected', 'error'));
  socket.on('connect_error', () => showToast('Connection failed', 'error'));
  
  socket.on('roomCreated', ({ roomCode: code, players }) => {
    roomCode = code;
    isHost = true;
    document.getElementById('roomCodeDisplay').textContent = code;
    document.getElementById('startGameBtn')?.classList.remove('hidden');
    updatePlayerList(players);
    showScreen('lobby');
    showToast('Room created!', 'success');
  });
  
  socket.on('playerJoined', ({ players }) => {
    updatePlayerList(players);
    showScreen('lobby');
  });
  
  socket.on('playerUpdated', ({ players }) => updatePlayerList(players));
  
  socket.on('playerLeft', ({ players, disconnectedPlayer }) => {
    updatePlayerList(players);
    showToast(`${disconnectedPlayer} left`, 'error');
  });
  
  socket.on('gameStarted', (state) => {
    gameState = state;
    document.getElementById('gameLog').innerHTML = '';
    showScreen('game');
    render();
    addLog('Game started! Swap cards if needed.');
  });
  
  socket.on('playStarted', (state) => {
    gameState = state;
    render();
    addLog('Play phase started!');
    const btn = document.getElementById('confirmSwapBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Done Swapping'; }
  });
  
  socket.on('gameState', (state) => {
    gameState = state;
    render();
    if (state.lastAction) addLog(state.lastAction);
  });
  
  socket.on('forcedCardPicked', (state) => {
    gameState = state;
    render();
    if (state.lastAction) addLog(state.lastAction);
  });
  
  socket.on('waiting', ({ message }) => showToast(message));
  
  socket.on('gameOver', ({ loser, message }) => {
    const isLoser = loser === myName;
    const msg = document.getElementById('gameOverMessage');
    if (msg) {
      msg.innerHTML = message || (isLoser 
        ? `<span style="color:var(--danger)">You are the 6KODA! 😅</span>` 
        : `<span style="color:var(--success)">You won! 🎉</span><br>${loser} is the 6KODA!`);
    }
    if (!isLoser) confetti();
    document.getElementById('gameOverModal')?.classList.remove('hidden');
    addLog(`Game over! ${loser} is the 6KODA!`);
  });
  
  socket.on('leaderboard', (data) => {
    const list = document.getElementById('leaderboardList');
    if (!list) return;
    
    const entries = Object.entries(data || {});
    if (!entries.length) {
      list.innerHTML = '<div class="lb-empty">No games yet!</div>';
    } else {
      const sorted = entries
        .map(([name, s]) => ({ name, wins: s.wins || 0, losses: s.losses || 0, rate: (s.wins || 0) / ((s.wins || 0) + (s.losses || 0) || 1) }))
        .sort((a, b) => b.rate - a.rate || b.wins - a.wins);
      
      const medals = ['🥇', '🥈', '🥉'];
      list.innerHTML = sorted.map((p, i) => `
        <div class="lb-item">
          <span class="rank">${medals[i] || '#' + (i + 1)}</span>
          <span class="name">${p.name}</span>
          <span class="stats">W:${p.wins} L:${p.losses}</span>
        </div>
      `).join('');
    }
    showScreen('leaderboard');
  });
  
  socket.on('error', ({ message }) => showToast(message, 'error'));
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
  console.log('6KODA v1.0');
  initSocket();
  showScreen('menu');
});