class Game {
    constructor(players) {
        this.players = new Map();
        this.playerOrder = [];
        this.currentPlayerIndex = 0;
        this.deck = [];
        this.pile = [];
        this.burnPile = [];
        this.phase = 'setup'; // setup, playing, finished
        this.mustPlayLowCard = false;
        this.forcedCard = null;
        this.forcedPlayerId = null;
        
        players.forEach(p => {
            this.players.set(p.id, {
                id: p.id,
                name: p.name,
                hand: [],
                faceUp: [],
                faceDown: [],
                ready: false,
                finished: false,
                finishOrder: null
            });
            this.playerOrder.push(p.id);
        });
        
        this.createDeck();
        this.shuffle();
    }

    createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        
        this.deck = [];
        for (const suit of suits) {
            for (const value of values) {
                this.deck.push({ suit, value, id: `${value}${suit}` });
            }
        }
    }

    shuffle() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    deal() {
        // Deal 3 face-down, 3 face-up, 3 in hand to each player
        for (const [id, player] of this.players) {
            player.faceDown = this.deck.splice(0, 3);
            player.faceUp = this.deck.splice(0, 3);
            player.hand = this.deck.splice(0, 3);
        }
    }

    swapCards(playerId, handIndex, faceUpIndex) {
        if (this.phase !== 'setup') {
            return { success: false, error: 'Cannot swap cards now' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        if (player.ready) {
            return { success: false, error: 'Already ready' };
        }
        
        if (handIndex < 0 || handIndex >= player.hand.length ||
            faceUpIndex < 0 || faceUpIndex >= player.faceUp.length) {
            return { success: false, error: 'Invalid card index' };
        }
        
        // Swap cards
        const temp = player.hand[handIndex];
        player.hand[handIndex] = player.faceUp[faceUpIndex];
        player.faceUp[faceUpIndex] = temp;
        
        return { success: true };
    }

    setPlayerReady(playerId) {
        if (this.phase !== 'setup') {
            return { success: false, error: 'Game already started' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        player.ready = true;
        
        // Check if all players are ready
        let allReady = true;
        for (const [, p] of this.players) {
            if (!p.ready) {
                allReady = false;
                break;
            }
        }
        
        if (allReady) {
            this.phase = 'playing';
        }
        
        return { success: true, gameStarted: allReady };
    }

    getCardValue(card) {
        const values = {
            '2': 15, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
            '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
        };
        return values[card.value] || 0;
    }

    // Sort cards by value for hand organization
    sortCards(cards) {
        const valueOrder = {
            '2': 15, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5,
            '8': 6, '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12
        };
        return cards.sort((a, b) => valueOrder[a.value] - valueOrder[b.value]);
    }

    getEffectiveTopCard() {
        // Look through pile from top, ignoring 3s (transparent)
        for (let i = this.pile.length - 1; i >= 0; i--) {
            if (this.pile[i].value !== '3') {
                return this.pile[i];
            }
        }
        return null; // All 3s or empty pile
    }

    canPlayCard(card) {
        // 2 and 10 can always be played
        if (card.value === '2' || card.value === '10') {
            return true;
        }
        
        // 3 (transparent) can always be played
        if (card.value === '3') {
            return true;
        }
        
        // If must play low card (after 7)
        if (this.mustPlayLowCard) {
            return this.getCardValue(card) <= 7;
        }
        
        // Empty pile - anything goes
        if (this.pile.length === 0) {
            return true;
        }
        
        const topCard = this.getEffectiveTopCard();
        
        // If effective top is null (all 3s), anything goes
        if (!topCard) {
            return true;
        }
        
        // BUG 1 FIX: If top card is a 2, anything can be played on it
        // (2 resets the pile - any card can follow)
        if (topCard.value === '2') {
            return true;
        }
        
        // Must play equal or higher
        return this.getCardValue(card) >= this.getCardValue(topCard);
    }

    playCards(playerId, cardIndices, source) {
        if (this.phase !== 'playing') {
            return { success: false, error: 'Game not in playing phase' };
        }
        
        const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
        if (playerId !== currentPlayerId) {
            return { success: false, error: 'Not your turn' };
        }
        
        // Check for forced card situation
        if (this.forcedCard && this.forcedPlayerId === playerId) {
            return { success: false, error: 'Must play or decline forced card' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        // Determine source
        let sourceCards;
        if (source === 'hand' && player.hand.length > 0) {
            sourceCards = player.hand;
        } else if (source === 'faceUp' && player.hand.length === 0 && player.faceUp.length > 0) {
            sourceCards = player.faceUp;
        } else if (source === 'faceDown' && player.hand.length === 0 && player.faceUp.length === 0 && player.faceDown.length > 0) {
            sourceCards = player.faceDown;
        } else {
            return { success: false, error: 'Invalid card source' };
        }
        
        // Validate indices
        if (!cardIndices || cardIndices.length === 0) {
            return { success: false, error: 'No cards selected' };
        }
        
        const uniqueIndices = [...new Set(cardIndices)].sort((a, b) => b - a);
        
        for (const idx of uniqueIndices) {
            if (idx < 0 || idx >= sourceCards.length) {
                return { success: false, error: 'Invalid card index' };
            }
        }
        
        // Get the cards
        const cards = uniqueIndices.map(i => sourceCards[i]);
        
        // Check if all cards have the same value
        const firstValue = cards[0].value;
        if (!cards.every(c => c.value === firstValue)) {
            return { success: false, error: 'All cards must have the same value' };
        }
        
        // For face-down cards, we play blind
        if (source === 'faceDown') {
            const card = cards[0]; // Can only play one face-down at a time
            
            // Remove from face-down
            player.faceDown.splice(uniqueIndices[0], 1);
            
            // Check if playable
            if (this.canPlayCard(card)) {
                this.pile.push(card);
                return this.processAfterPlay(playerId, [card]);
            } else {
                // Must pick up pile + the card
                player.hand.push(card, ...this.pile);
                // BUG 4 FIX: Sort the hand after picking up
                player.hand = this.sortCards(player.hand);
                this.pile = [];
                this.mustPlayLowCard = false;
                this.nextPlayer();
                return { success: true, pickedUp: true };
            }
        }
        
        // Check if cards can be played
        if (!this.canPlayCard(cards[0])) {
            return { success: false, error: 'Cannot play this card' };
        }
        
        // Remove cards from source and add to pile
        for (const idx of uniqueIndices) {
            sourceCards.splice(idx, 1);
        }
        
        this.pile.push(...cards);
        
        return this.processAfterPlay(playerId, cards);
    }

    processAfterPlay(playerId, cards) {
        const player = this.players.get(playerId);
        const card = cards[0];
        
        // Draw cards if deck has cards and hand has less than 3
        while (this.deck.length > 0 && player.hand.length < 3) {
            player.hand.push(this.deck.shift());
        }
        // Sort hand after drawing
        player.hand = this.sortCards(player.hand);
        
        // Check for burn (10 or four of a kind)
        const shouldBurn = card.value === '10' || this.checkFourOfAKind();
        
        if (shouldBurn) {
            this.burnPile.push(...this.pile);
            this.pile = [];
            this.mustPlayLowCard = false;
            // Same player goes again
            
            // Check if player finished
            if (this.checkPlayerFinished(playerId)) {
                this.nextPlayer();
                return { success: true, burned: true, finished: true };
            }
            
            return { success: true, burned: true };
        }
        
        // BUG 3 FIX: Handle mustPlayLowCard with transparent 3
        // Only update mustPlayLowCard based on the EFFECTIVE card played
        if (card.value === '7') {
            // 7 was played - next player must play 7 or lower
            this.mustPlayLowCard = true;
        } else if (card.value === '3') {
            // 3 is transparent - don't change mustPlayLowCard
            // It keeps whatever state it had before
        } else if (card.value === '2') {
            // 2 resets everything
            this.mustPlayLowCard = false;
        } else {
            // Any other card clears the mustPlayLowCard requirement
            this.mustPlayLowCard = false;
        }
        
        // Check if player finished
        if (this.checkPlayerFinished(playerId)) {
            this.nextPlayer();
            return { success: true, finished: true };
        }
        
        this.nextPlayer();
        return { success: true };
    }

    checkFourOfAKind() {
        if (this.pile.length < 4) return false;
        
        const topFour = this.pile.slice(-4);
        const value = topFour[0].value;
        return topFour.every(c => c.value === value);
    }

    checkPlayerFinished(playerId) {
        const player = this.players.get(playerId);
        if (!player) return false;
        
        if (player.hand.length === 0 && player.faceUp.length === 0 && player.faceDown.length === 0) {
            if (!player.finished) {
                player.finished = true;
                player.finishOrder = this.getFinishedCount();
            }
            return true;
        }
        return false;
    }

    getFinishedCount() {
        let count = 0;
        for (const [, player] of this.players) {
            if (player.finished) count++;
        }
        return count;
    }

    pickFromDeck(playerId) {
        if (this.phase !== 'playing') {
            return { success: false, error: 'Game not in playing phase' };
        }
        
        const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
        if (playerId !== currentPlayerId) {
            return { success: false, error: 'Not your turn' };
        }
        
        if (this.forcedCard) {
            return { success: false, error: 'Must resolve forced card first' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        if (player.hand.length === 0) {
            return { success: false, error: 'Can only draw when playing from hand' };
        }
        
        if (this.deck.length === 0) {
            return { success: false, error: 'Deck is empty' };
        }
        
        const drawnCard = this.deck.shift();
        
        // If hand has 3 cards, must play the drawn card
        if (player.hand.length >= 3) {
            this.forcedCard = drawnCard;
            this.forcedPlayerId = playerId;
            return { 
                success: true, 
                forcedCard: drawnCard,
                mustPlay: true
            };
        }
        
        // Otherwise, add to hand and sort
        player.hand.push(drawnCard);
        player.hand = this.sortCards(player.hand);
        return { success: true, drawnCard };
    }

    playForcedCard(playerId) {
        if (!this.forcedCard || this.forcedPlayerId !== playerId) {
            return { success: false, error: 'No forced card to play' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        const card = this.forcedCard;
        
        if (!this.canPlayCard(card)) {
            return { success: false, error: 'Cannot play this card - must decline' };
        }
        
        // Play the forced card
        this.pile.push(card);
        this.forcedCard = null;
        this.forcedPlayerId = null;
        
        return this.processAfterPlay(playerId, [card]);
    }

    declineForcedCard(playerId) {
        if (!this.forcedCard || this.forcedPlayerId !== playerId) {
            return { success: false, error: 'No forced card to decline' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        // Add forced card and pile to hand
        player.hand.push(this.forcedCard, ...this.pile);
        // BUG 4 FIX: Sort the hand after picking up
        player.hand = this.sortCards(player.hand);
        this.pile = [];
        this.mustPlayLowCard = false;
        this.forcedCard = null;
        this.forcedPlayerId = null;
        
        this.nextPlayer();
        return { success: true, pickedUp: true };
    }

    // BUG 2 FIX: pickUpPile should NOT advance to next player
    // The same player continues their turn after picking up
    pickUpPile(playerId) {
        if (this.phase !== 'playing') {
            return { success: false, error: 'Game not in playing phase' };
        }
        
        const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
        if (playerId !== currentPlayerId) {
            return { success: false, error: 'Not your turn' };
        }
        
        if (this.forcedCard) {
            return { success: false, error: 'Must resolve forced card first' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        if (this.pile.length === 0) {
            return { success: false, error: 'Pile is empty' };
        }
        
        player.hand.push(...this.pile);
        // BUG 4 FIX: Sort the hand after picking up
        player.hand = this.sortCards(player.hand);
        this.pile = [];
        this.mustPlayLowCard = false;
        
        // BUG 2 FIX: Do NOT call nextPlayer() here
        // The same player must play a card after picking up the pile
        // They now have cards and must play one
        
        return { success: true, samePlayerContinues: true };
    }

    nextPlayer() {
        let attempts = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
            attempts++;
            
            const player = this.players.get(this.playerOrder[this.currentPlayerIndex]);
            if (!player.finished) {
                return;
            }
        } while (attempts < this.playerOrder.length);
    }

    isGameOver() {
        let unfinishedCount = 0;
        for (const [, player] of this.players) {
            if (!player.finished) {
                unfinishedCount++;
            }
        }
        return unfinishedCount <= 1;
    }

    getLoser() {
        for (const [, player] of this.players) {
            if (!player.finished) {
                return player;
            }
        }
        return null;
    }

    getWinner() {
        let firstFinished = null;
        for (const [, player] of this.players) {
            if (player.finished && player.finishOrder === 1) {
                firstFinished = player;
                break;
            }
        }
        return firstFinished;
    }

    getStateForPlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player) return null;
        
        const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
        
        const opponents = [];
        for (const [id, p] of this.players) {
            if (id !== playerId) {
                opponents.push({
                    id: p.id,
                    name: p.name,
                    handCount: p.hand.length,
                    faceUp: p.faceUp,
                    faceDownCount: p.faceDown.length,
                    ready: p.ready,
                    finished: p.finished
                });
            }
        }
        
        return {
            phase: this.phase,
            hand: player.hand,
            faceUp: player.faceUp,
            faceDown: player.faceDown,
            faceDownCount: player.faceDown.length,
            pile: this.pile,
            pileTop: this.pile.length > 0 ? this.pile[this.pile.length - 1] : null,
            pileCount: this.pile.length,
            deckCount: this.deck.length,
            opponents,
            isMyTurn: currentPlayerId === playerId,
            currentPlayer: this.players.get(currentPlayerId)?.name || 'Unknown',
            mustPlayLowCard: this.mustPlayLowCard,
            ready: player.ready,
            finished: player.finished,
            forcedCard: this.forcedPlayerId === playerId ? this.forcedCard : null,
            effectiveTopCard: this.getEffectiveTopCard()
        };
    }
}

module.exports = Game;
