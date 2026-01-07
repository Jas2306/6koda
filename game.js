class Game {
  constructor(players) {
    if (!Array.isArray(players) || players.length < 2) {
      throw new Error('Need at least 2 players');
    }
    if (players.length > 5) {
      throw new Error('Maximum 5 players allowed');
    }

    this.players = players.map(p => ({
      id: p.id,
      name: p.name || 'Unknown',
      hand: [],
      faceUp: [],
      faceDown: [],
      ready: false,
      finished: false
    }));

    this.deck = [];
    this.pile = [];
    this.burnedCards = [];
    this.currentPlayerIndex = 0;
    this.phase = 'setup';
    this.mustPlayLowCard = false;
    this.forcedCard = null;
    this.gameStartTime = Date.now();
  }

  // ==================== DECK ====================

  createDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    this.deck = [];

    for (const suit of suits) {
      for (const value of values) {
        this.deck.push({
          suit,
          value,
          id: `${value}_${suit}_${Math.random().toString(36).substr(2, 9)}`
        });
      }
    }

    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  deal() {
    if (this.phase !== 'setup') {
      return { error: 'Can only deal during setup' };
    }

    this.createDeck();

    for (const player of this.players) {
      player.faceDown = this.deck.splice(0, 3);
      player.faceUp = this.deck.splice(0, 3);
      player.hand = this.deck.splice(0, 3);
      player.ready = false;
      player.finished = false;
    }

    this.pile = [];
    this.burnedCards = [];
    this.mustPlayLowCard = false;
    this.forcedCard = null;
    this.currentPlayerIndex = 0;
    this.phase = 'swapping';

    return { success: true };
  }

  // ==================== HELPERS ====================

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId) || null;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex] || null;
  }

  isCurrentPlayer(playerId) {
    const current = this.getCurrentPlayer();
    return current && current.id === playerId;
  }

  validateTurn(playerId) {
    if (this.phase !== 'playing') {
      return { valid: false, error: 'Game is not in playing phase' };
    }
    if (!this.isCurrentPlayer(playerId)) {
      return { valid: false, error: 'Not your turn!' };
    }
    const player = this.getPlayer(playerId);
    if (!player) {
      return { valid: false, error: 'Player not found' };
    }
    if (player.finished) {
      return { valid: false, error: 'You already finished!' };
    }
    return { valid: true, player };
  }

  getPlaySource(player) {
    if (!player) return null;
    if (player.hand?.length > 0) return 'hand';
    if (player.faceUp?.length > 0) return 'faceUp';
    if (player.faceDown?.length > 0) return 'faceDown';
    return null;
  }

  getCardValue(card) {
    if (!card?.value) return 0;
    const values = {
      '2': 15, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
      '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    return values[card.value] || 0;
  }

  getSuitSymbol(suit) {
    const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    return symbols[suit] || '';
  }

  formatCard(card) {
    if (!card) return '?';
    return `${card.value}${this.getSuitSymbol(card.suit)}`;
  }

  getEffectiveTopCard() {
    if (!this.pile?.length) return null;
    for (let i = this.pile.length - 1; i >= 0; i--) {
      if (this.pile[i]?.value !== '3') {
        return this.pile[i];
      }
    }
    return null;
  }

  canPlayCard(card) {
    if (!card?.value) return false;
    if (!this.pile?.length) return true;
    if (['2', '10', '3'].includes(card.value)) return true;
    if (this.mustPlayLowCard) {
      return this.getCardValue(card) <= 7;
    }
    const effective = this.getEffectiveTopCard();
    if (!effective) return true;
    return this.getCardValue(card) >= this.getCardValue(effective);
  }

  checkFourOfAKind() {
    if (!this.pile || this.pile.length < 4) return false;
    const lastFour = this.pile.slice(-4);
    return lastFour.every(c => c?.value === lastFour[0]?.value);
  }

  burnPile() {
    this.burnedCards.push(...this.pile);
    this.pile = [];
    this.mustPlayLowCard = false;
  }

  checkPlayerFinished(player) {
    if (!player) return;
    const total = (player.hand?.length || 0) +
                  (player.faceUp?.length || 0) +
                  (player.faceDown?.length || 0);
    if (total === 0) {
      player.finished = true;
    }
  }

  nextPlayer() {
    if (this.isGameOver()) {
      this.phase = 'ended';
      return;
    }
    const start = this.currentPlayerIndex;
    let loops = 0;
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      loops++;
      if (loops > this.players.length + 1) break;
    } while (this.players[this.currentPlayerIndex].finished && this.currentPlayerIndex !== start);
  }

  isGameOver() {
    return this.players.filter(p => !p.finished).length <= 1;
  }

  getLoser() {
    return this.players.find(p => !p.finished) || null;
  }

  // ==================== SWAPPING ====================

  swapCards(playerId, handIndex, faceUpIndex) {
    if (this.phase !== 'swapping') {
      return { error: 'Can only swap during swapping phase' };
    }
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Player not found' };
    if (player.ready) return { error: 'Already confirmed ready' };
    if (typeof handIndex !== 'number' || typeof faceUpIndex !== 'number') {
      return { error: 'Invalid indices' };
    }
    if (handIndex < 0 || handIndex >= player.hand.length) {
      return { error: 'Invalid hand index' };
    }
    if (faceUpIndex < 0 || faceUpIndex >= player.faceUp.length) {
      return { error: 'Invalid face-up index' };
    }

    const temp = player.hand[handIndex];
    player.hand[handIndex] = player.faceUp[faceUpIndex];
    player.faceUp[faceUpIndex] = temp;

    return { success: true };
  }

  confirmReady(playerId) {
    if (this.phase !== 'swapping') {
      return { error: 'Not in swapping phase' };
    }
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Player not found' };
    player.ready = true;
    return { success: true };
  }

  allReady() {
    return this.players.every(p => p.ready);
  }

  startPlay() {
    if (this.phase !== 'swapping') {
      return { error: 'Not in swapping phase' };
    }
    if (!this.allReady()) {
      return { error: 'Not all players ready' };
    }
    this.phase = 'playing';
    this.currentPlayerIndex = 0;
    this.players.forEach(p => p.ready = false);
    return { success: true };
  }

  // ==================== PICK FROM DECK ====================

  pickFromDeck(playerId) {
    const validation = this.validateTurn(playerId);
    if (!validation.valid) return { error: validation.error };

    const player = validation.player;
    const source = this.getPlaySource(player);

    if (source !== 'hand') {
      return { error: 'Can only draw from deck when playing from hand!' };
    }
    if (!this.deck?.length) {
      return { error: 'Deck is empty!' };
    }
    if (this.forcedCard?.playerId === playerId) {
      return { error: 'Must play or decline the drawn card first!' };
    }

    const pickedCard = this.deck.pop();
    if (!pickedCard) return { error: 'Failed to draw card' };

    if (player.hand.length < 3) {
      player.hand.push(pickedCard);
      return {
        action: `${player.name} drew a card (${this.formatCard(pickedCard)})`,
        pickedCard,
        mustPlay: false
      };
    } else {
      this.forcedCard = { playerId, card: pickedCard };
      return {
        action: `${player.name} drew ${this.formatCard(pickedCard)} - must play or decline!`,
        pickedCard,
        mustPlay: true,
        canPlayIt: this.canPlayCard(pickedCard)
      };
    }
  }

  playForcedCard(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Player not found' };
    if (!this.forcedCard || this.forcedCard.playerId !== playerId) {
      return { error: 'No forced card to play!' };
    }

    const card = this.forcedCard.card;

    if (!this.canPlayCard(card)) {
      player.hand.push(...this.pile, card);
      this.pile = [];
      this.mustPlayLowCard = false;
      this.forcedCard = null;
      this.nextPlayer();
      return {
        action: `${player.name} couldn't play ${this.formatCard(card)} - picked up pile! 😅`
      };
    }

    this.pile.push(card);
    this.forcedCard = null;
    this.mustPlayLowCard = false;

    let action = `${player.name} played ${this.formatCard(card)}`;
    let sameTurn = false;

    const result = this.handleSpecialCard(card, player);
    action += result.suffix;
    sameTurn = result.sameTurn;

    if (!sameTurn) this.nextPlayer();

    this.checkPlayerFinished(player);
    if (player.finished) action += ` - ${player.name} is OUT! 🎉`;

    return { action };
  }

  declineForcedCard(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Player not found' };
    if (!this.forcedCard || this.forcedCard.playerId !== playerId) {
      return { error: 'No forced card!' };
    }

    const card = this.forcedCard.card;
    player.hand.push(...this.pile, card);
    this.pile = [];
    this.mustPlayLowCard = false;
    this.forcedCard = null;
    this.nextPlayer();

    return {
      action: `${player.name} declined ${this.formatCard(card)} and picked up pile 📥`
    };
  }

  // ==================== PLAY CARDS ====================

  playCards(playerId, cardIndices) {
    const validation = this.validateTurn(playerId);
    if (!validation.valid) return { error: validation.error };

    const player = validation.player;

    if (this.forcedCard?.playerId === playerId) {
      return { error: 'Must play or decline drawn card first!' };
    }
    if (!Array.isArray(cardIndices) || !cardIndices.length) {
      return { error: 'No cards selected!' };
    }

    const uniqueIndices = [...new Set(cardIndices)].filter(i => typeof i === 'number' && i >= 0);
    if (!uniqueIndices.length) return { error: 'Invalid selection!' };

    const source = this.getPlaySource(player);
    if (!source) return { error: 'No cards to play!' };

    const sourceCards = player[source];
    for (const idx of uniqueIndices) {
      if (idx >= sourceCards.length) return { error: 'Invalid card index!' };
    }

    const cards = uniqueIndices.map(i => sourceCards[i]).filter(c => c);
    if (!cards.length) return { error: 'No valid cards!' };

    const firstValue = cards[0].value;
    if (!cards.every(c => c.value === firstValue)) {
      return { error: 'All cards must have same value!' };
    }

    // Face down - blind play
    if (source === 'faceDown') {
      if (uniqueIndices.length !== 1) {
        return { error: 'Must flip one card at a time!' };
      }
      const card = cards[0];
      player.faceDown = player.faceDown.filter((_, i) => i !== uniqueIndices[0]);

      if (!this.canPlayCard(card)) {
        player.hand.push(...this.pile, card);
        this.pile = [];
        this.mustPlayLowCard = false;
        this.nextPlayer();
        return { action: `${player.name} flipped ${this.formatCard(card)} - picked up! 😅` };
      }

      this.pile.push(card);
      this.mustPlayLowCard = false;

      let action = `${player.name} flipped ${this.formatCard(card)}`;
      let sameTurn = false;

      const result = this.handleSpecialCard(card, player);
      action += result.suffix;
      sameTurn = result.sameTurn;

      if (!sameTurn) this.nextPlayer();

      this.checkPlayerFinished(player);
      if (player.finished) action += ` - ${player.name} is OUT! 🎉`;

      return { action };
    }

    // Normal play
    if (!this.canPlayCard(cards[0])) {
      if (this.mustPlayLowCard) {
        return { error: 'Must play 7 or lower! (or 2, 3, 10)' };
      }
      return { error: 'Card too low!' };
    }

    // Remove cards
    const sorted = [...uniqueIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      player[source].splice(idx, 1);
    }

    this.pile.push(...cards);

    // Draw if from hand
    if (source === 'hand') {
      while (player.hand.length < 3 && this.deck.length > 0) {
        player.hand.push(this.deck.pop());
      }
    }

    const cardNames = cards.map(c => this.formatCard(c)).join(', ');
    let action = `${player.name} played ${cardNames}`;
    let sameTurn = false;

    this.mustPlayLowCard = false;
    const result = this.handleSpecialCard(cards[0], player, cards.length);
    action += result.suffix;
    sameTurn = result.sameTurn;

    if (!sameTurn) this.nextPlayer();

    this.checkPlayerFinished(player);
    if (player.finished) action += ` - ${player.name} is OUT! 🎉`;

    return { action };
  }

  handleSpecialCard(card, player, count = 1) {
    let suffix = '';
    let sameTurn = false;

    if (this.checkFourOfAKind()) {
      this.burnPile();
      suffix = ' - FOUR OF A KIND BURN! 🔥🔥';
      sameTurn = true;
    } else if (card.value === '10') {
      this.burnPile();
      suffix = ' - BURN! 🔥';
      sameTurn = true;
    } else if (card.value === '3') {
      const effective = this.getEffectiveTopCard();
      suffix = effective
        ? ` (transparent - beat ${effective.value}) 👻`
        : ' (transparent) 👻';
    } else if (card.value === '7') {
      this.mustPlayLowCard = true;
      suffix = ' - Next plays ≤7! ⬇️';
    }

    return { suffix, sameTurn };
  }

  // ==================== PICK UP PILE ====================

  pickUpPile(playerId) {
    if (this.forcedCard?.playerId === playerId) {
      return this.declineForcedCard(playerId);
    }

    const validation = this.validateTurn(playerId);
    if (!validation.valid) return { error: validation.error };

    const player = validation.player;
    if (!this.pile?.length) {
      return { error: 'Pile is empty!' };
    }

    player.hand.push(...this.pile);
    this.pile = [];
    this.mustPlayLowCard = false;
    this.nextPlayer();

    return { action: `${player.name} picked up the pile 📥` };
  }

  // ==================== GAME STATE ====================

  getStateForPlayer(playerId) {
    const player = this.getPlayer(playerId);
    const current = this.getCurrentPlayer();
    const effective = this.getEffectiveTopCard();

    const hasForcedCard = this.forcedCard?.playerId === playerId;
    const forcedCardData = hasForcedCard ? this.forcedCard.card : null;
    const canPlayForced = hasForcedCard ? this.canPlayCard(this.forcedCard.card) : false;

    return {
      phase: this.phase,
      currentPlayer: current?.id || null,
      currentPlayerName: current?.name || 'Unknown',
      pile: this.pile || [],
      pileCount: this.pile?.length || 0,
      effectiveTopCard: effective,
      mustPlayLowCard: this.mustPlayLowCard,
      deckCount: this.deck?.length || 0,
      burnedCount: this.burnedCards?.length || 0,

      myHand: player?.hand || [],
      myFaceUp: player?.faceUp || [],
      myFaceDownCount: player?.faceDown?.length || 0,
      amIFinished: player?.finished || false,

      hasForcedCard,
      forcedCard: forcedCardData,
      canPlayForcedCard: canPlayForced,

      isGameOver: this.isGameOver(),

      opponents: this.players
        .filter(p => p.id !== playerId)
        .map(p => ({
          id: p.id,
          name: p.name,
          handCount: p.hand?.length || 0,
          faceUp: p.faceUp || [],
          faceDownCount: p.faceDown?.length || 0,
          finished: p.finished
        }))
    };
  }
}

module.exports = Game;