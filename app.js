const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const MAX_PASSWORD_LENGTH = 64;

const CARD_TYPES = [
  {
    value: 1,
    key: 'scout',
    name: '見習い配達人',
    count: 5,
    tone: 'rose',
    image: '/assets/cards/01-scout.png',
    effect: '相手ひとりを選び、見習い配達人以外のカード名を宣言する。当たれば相手は脱落する。',
    shortEffect: '手札を推理して当てる',
    targetMode: 'opponent',
    needsGuess: true
  },
  {
    value: 2,
    key: 'seer',
    name: '占い師',
    count: 2,
    tone: 'blue',
    image: '/assets/cards/02-seer.png',
    effect: '相手ひとりの手札を見る。',
    shortEffect: '相手の手札を見る',
    targetMode: 'opponent'
  },
  {
    value: 3,
    key: 'duel',
    name: '決闘士',
    count: 2,
    tone: 'amber',
    image: '/assets/cards/03-duel.png',
    effect: '相手ひとりと手札の数字を比べ、小さい方が脱落する。同じなら何も起きない。',
    shortEffect: '数字を比べる',
    targetMode: 'opponent'
  },
  {
    value: 4,
    key: 'veil',
    name: '封蝋の護り',
    count: 2,
    tone: 'green',
    image: '/assets/cards/04-veil.png',
    effect: '次の自分の番まで、相手の効果の対象にならない。',
    shortEffect: '一時的に守られる',
    targetMode: 'none'
  },
  {
    value: 5,
    key: 'patron',
    name: '後援者',
    count: 2,
    tone: 'violet',
    image: '/assets/cards/05-patron.png',
    effect: '誰かひとりを選ぶ。その人は手札を捨てて新しく1枚引く。密書を捨てたなら脱落する。',
    shortEffect: '手札を捨てさせる',
    targetMode: 'any'
  },
  {
    value: 6,
    key: 'envoy',
    name: '密使',
    count: 1,
    tone: 'teal',
    image: '/assets/cards/06-envoy.png',
    effect: '相手ひとりと手札を交換する。',
    shortEffect: '手札を交換する',
    targetMode: 'opponent'
  },
  {
    value: 7,
    key: 'archivist',
    name: '記録官',
    count: 1,
    tone: 'slate',
    image: '/assets/cards/07-archivist.png',
    effect: '効果はない。ただし後援者か密使と一緒に持っているなら、必ず記録官を出す。',
    shortEffect: '条件付きで必ず出す',
    targetMode: 'none'
  },
  {
    value: 8,
    key: 'sealedLetter',
    name: '密書',
    count: 1,
    tone: 'gold',
    image: '/assets/cards/08-sealed-letter.png',
    effect: 'このカードを捨てたら脱落する。',
    shortEffect: '捨てると脱落',
    targetMode: 'none'
  }
];

const CARD_TYPE_BY_VALUE = new Map(CARD_TYPES.map((card) => [card.value, card]));
const CARD_TYPE_BY_KEY = new Map(CARD_TYPES.map((card) => [card.key, card]));
const GAME_RULES = {
  totalCards: CARD_TYPES.reduce((total, card) => total + card.count, 0),
  setup: ['各プレイヤーに1枚配り、山札から1枚を非公開で除外します。', '手番では1枚引いて、2枚の手札から1枚を出します。'],
  turn: ['カードを出したら、そのカードの効果を解決します。', '脱落したプレイヤーはそのラウンドに戻れません。'],
  winning: ['最後まで残ったプレイヤーがラウンド勝者です。', '山札が尽きたら、残った手札の数字が高い人が勝者です。同値なら捨て札合計で比べます。', '2人戦は4点、3〜4人戦は3点でゲーム勝利です。'],
  notes: ['封蝋の護りは次の自分の番が来るまで相手の効果対象になりません。', '記録官と後援者または密使を同時に持ったら、記録官を出す必要があります。', '密書を捨てたプレイヤーは即座に脱落します。']
};
const rooms = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('roomListUpdate', listRoomSummaries());

  socket.on('listRooms', (reply) => {
    if (isRateLimited(socket, 'listRooms', 500)) {
      reply?.({ ok: false, error: '少し待ってから更新してください。' });
      return;
    }

    reply?.({ ok: true, rooms: listRoomSummaries() });
  });

  socket.on('createRoom', (payload = {}, reply) => {
    if (isRateLimited(socket, 'createRoom', 800)) {
      reply?.({ ok: false, error: '少し待ってから操作してください。' });
      return;
    }

    if (socket.data.roomCode && rooms.has(socket.data.roomCode)) {
      reply?.({ ok: false, error: 'すでに部屋に参加しています。' });
      return;
    }

    const { name, password } = payload || {};
    const playerName = cleanName(name);
    const roomPassword = cleanPassword(password);
    if (!playerName) {
      reply?.({ ok: false, error: '名前を入力してください。' });
      return;
    }

    const roomCode = createRoomCode();
    const room = createRoom(roomCode, socket.id, playerName, roomPassword);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = socket.id;

    reply?.({ ok: true, roomCode, playerId: socket.id });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on('joinRoom', (payload = {}, reply) => {
    if (isRateLimited(socket, 'joinRoom', 800)) {
      reply?.({ ok: false, error: '少し待ってから操作してください。' });
      return;
    }

    if (socket.data.roomCode && rooms.has(socket.data.roomCode)) {
      reply?.({ ok: false, error: 'すでに部屋に参加しています。' });
      return;
    }

    const { roomCode, name, password } = payload || {};
    const normalizedCode = normalizeRoomCode(roomCode);
    const playerName = cleanName(name);
    const roomPassword = cleanPassword(password);
    const room = rooms.get(normalizedCode);

    if (!room) {
      reply?.({ ok: false, error: '部屋が見つかりません。' });
      return;
    }

    if (!playerName) {
      reply?.({ ok: false, error: '名前を入力してください。' });
      return;
    }

    if (room.phase !== 'lobby') {
      reply?.({ ok: false, error: '進行中の部屋には参加できません。' });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      reply?.({ ok: false, error: 'この部屋は満員です。' });
      return;
    }

    if (room.password && !roomPassword) {
      reply?.({ ok: false, error: 'この部屋には合言葉が必要です。' });
      return;
    }

    if (room.password && !verifyRoomPassword(room, roomPassword)) {
      reply?.({ ok: false, error: '合言葉が違います。' });
      return;
    }

    room.players.push(createPlayer(socket.id, playerName));
    room.log.push(`${playerName} が参加しました。`);

    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    socket.data.playerId = socket.id;

    reply?.({ ok: true, roomCode: normalizedCode, playerId: socket.id });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on('startGame', (payload = {}, reply) => {
    if (isRateLimited(socket, 'startGame', 500)) {
      reply?.({ ok: false, error: '少し待ってから操作してください。' });
      return;
    }

    const { roomCode } = payload || {};
    const room = getSocketRoom(socket, roomCode);
    if (!room) {
      reply?.({ ok: false, error: '部屋が見つかりません。' });
      return;
    }

    if (room.hostId !== socket.id) {
      reply?.({ ok: false, error: '部屋主だけが開始できます。' });
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      reply?.({ ok: false, error: '2人以上で開始できます。' });
      return;
    }

    startRound(room);
    reply?.({ ok: true });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on('playCard', (payload = {}, reply) => {
    if (isRateLimited(socket, 'playCard', 250)) {
      reply?.({ ok: false, error: '少し待ってから操作してください。' });
      return;
    }

    const { roomCode, cardUid, targetId, guessValue } = payload || {};
    const room = getSocketRoom(socket, roomCode);
    if (!room) {
      reply?.({ ok: false, error: '部屋が見つかりません。' });
      return;
    }

    const result = playCard(room, socket.id, cardUid, targetId, Number(guessValue));
    reply?.(result.ok ? { ok: true } : result);
    broadcastRoom(room);
  });

  socket.on('nextRound', (payload = {}, reply) => {
    if (isRateLimited(socket, 'nextRound', 500)) {
      reply?.({ ok: false, error: '少し待ってから操作してください。' });
      return;
    }

    const { roomCode } = payload || {};
    const room = getSocketRoom(socket, roomCode);
    if (!room) {
      reply?.({ ok: false, error: '部屋が見つかりません。' });
      return;
    }

    if (room.hostId !== socket.id) {
      reply?.({ ok: false, error: '部屋主だけが次のラウンドを始められます。' });
      return;
    }

    if (room.phase !== 'roundOver' && room.phase !== 'gameOver') {
      reply?.({ ok: false, error: '今は次のラウンドを開始できません。' });
      return;
    }

    if (room.phase === 'gameOver') {
      room.players.forEach((player) => {
        player.score = 0;
      });
      room.round = 0;
      room.log.push('新しいゲームを始めます。');
    }

    compactDisconnectedPlayers(room);
    if (room.players.length < MIN_PLAYERS) {
      resetRoomToLobby(room, '参加者が足りないため、ロビーに戻りました。');
      reply?.({ ok: true });
      broadcastRoom(room);
      broadcastRoomList();
      return;
    }

    startRound(room);
    reply?.({ ok: true });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on('leaveRoom', (_, reply) => {
    const room = rooms.get(socket.data.roomCode);
    if (room) {
      removePlayerFromRoom(room, socket.id, '退室しました。');
      socket.leave(room.code);
      broadcastRoom(room);
      broadcastRoomList();
    }
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    reply?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      return;
    }

    const player = room.players.find((entry) => entry.id === socket.id);
    if (!player) {
      return;
    }

    if (room.phase === 'lobby') {
      removePlayerFromRoom(room, socket.id, '接続が切れました。');
    } else {
      player.connected = false;
      assignHostIfNeeded(room);
      if (!player.eliminated) {
        eliminatePlayer(room, player, '接続が切れたため脱落しました。');
      }
      resolveRoundOrAdvance(room);
    }

    if (room.players.every((entry) => !entry.connected)) {
      rooms.delete(room.code);
      broadcastRoomList();
      return;
    }

    broadcastRoom(room);
    broadcastRoomList();
  });
});

function createRoom(code, hostId, hostName, password) {
  return {
    code,
    hostId,
    createdAt: Date.now(),
    phase: 'lobby',
    round: 0,
    targetScore: 3,
    password: password ? hashPassword(password) : null,
    players: [createPlayer(hostId, hostName)],
    deck: [],
    burnCard: null,
    currentTurnIndex: 0,
    roundWinnerIds: [],
    lastPlayed: null,
    log: [`${hostName} が部屋を作りました。`],
    insights: new Map()
  };
}

function createPlayer(id, name) {
  return {
    id,
    name,
    score: 0,
    hand: [],
    discard: [],
    eliminated: false,
    protected: false,
    connected: true
  };
}

function startRound(room) {
  room.players = room.players.filter((player) => player.connected);
  assignHostIfNeeded(room);
  room.phase = 'playing';
  room.round += 1;
  room.roundWinnerIds = [];
  room.lastPlayed = null;
  room.insights.clear();
  room.deck = shuffle(buildDeck());
  room.burnCard = draw(room.deck);
  room.targetScore = room.players.length === 2 ? 4 : 3;

  room.players.forEach((player) => {
    player.hand = [draw(room.deck)];
    player.discard = [];
    player.eliminated = false;
    player.protected = false;
  });

  room.currentTurnIndex = (room.round - 1) % room.players.length;
  room.log.push(`ラウンド ${room.round} を開始しました。`);
  beginTurn(room);
}

function beginTurn(room) {
  const player = getCurrentPlayer(room);
  if (!player || player.eliminated) {
    advanceTurn(room);
    return;
  }

  player.protected = false;
  room.insights.delete(player.id);

  if (room.deck.length > 0) {
    player.hand.push(draw(room.deck));
  }

  room.log.push(`${player.name} の番です。`);
}

function playCard(room, playerId, cardUid, targetId, guessValue) {
  if (room.phase !== 'playing') {
    return { ok: false, error: '今はカードを出せません。' };
  }

  const player = room.players.find((entry) => entry.id === playerId);
  const currentPlayer = getCurrentPlayer(room);

  if (!player || player.eliminated || !player.connected) {
    return { ok: false, error: 'このラウンドには参加していません。' };
  }

  if (!currentPlayer || currentPlayer.id !== playerId) {
    return { ok: false, error: 'まだあなたの番ではありません。' };
  }

  const cardIndex = player.hand.findIndex((card) => card.uid === cardUid);
  if (cardIndex === -1) {
    return { ok: false, error: 'そのカードは手札にありません。' };
  }

  const selectedCard = player.hand[cardIndex];
  const selectedType = CARD_TYPE_BY_KEY.get(selectedCard.key);
  const forcedCard = getForcedCard(player.hand);

  if (forcedCard && selectedCard.uid !== forcedCard.uid) {
    return { ok: false, error: '記録官を出す必要があります。' };
  }

  if (selectedType.needsGuess && (!Number.isInteger(guessValue) || guessValue < 2 || guessValue > 8)) {
    return { ok: false, error: '宣言するカードを選んでください。' };
  }

  const target = resolveTarget(room, player, selectedType, targetId);
  if (target.error) {
    return target;
  }

  player.hand.splice(cardIndex, 1);
  player.discard.push(selectedCard);
  room.lastPlayed = {
    playerId: player.id,
    playerName: player.name,
    card: selectedCard
  };
  room.insights.delete(player.id);
  room.log.push(`${player.name} は ${selectedType.name} を出しました。`);

  applyCardEffect(room, player, selectedCard, target.player, guessValue);
  resolveRoundOrAdvance(room);
  return { ok: true };
}

function applyCardEffect(room, player, card, target, guessValue) {
  switch (card.key) {
    case 'scout': {
      if (!target || target.hand.length === 0) {
        room.log.push('有効な対象がいなかったため、効果は発生しませんでした。');
        return;
      }
      const guessedType = CARD_TYPE_BY_VALUE.get(guessValue);
      room.log.push(`${player.name} は ${target.name} の手札を「${guessedType.name}」と宣言しました。`);
      if (target.hand[0].value === guessValue) {
        eliminatePlayer(room, target, '宣言が当たりました。');
      } else {
        room.log.push('宣言は外れました。');
      }
      break;
    }
    case 'seer': {
      if (target && target.hand[0]) {
        room.insights.set(player.id, {
          type: 'peek',
          targetId: target.id,
          targetName: target.name,
          card: target.hand[0],
          message: `${target.name} の手札を確認しました。`
        });
        room.log.push(`${player.name} は ${target.name} の手札を確認しました。`);
      }
      break;
    }
    case 'duel': {
      if (!target || !target.hand[0] || !player.hand[0]) {
        return;
      }
      const playerCard = player.hand[0];
      const targetCard = target.hand[0];
      room.log.push(`${player.name} と ${target.name} が手札の強さを比べました。`);
      if (playerCard.value > targetCard.value) {
        eliminatePlayer(room, target, `${target.name} の数字が小さかったため脱落しました。`);
      } else if (playerCard.value < targetCard.value) {
        eliminatePlayer(room, player, `${player.name} の数字が小さかったため脱落しました。`);
      } else {
        room.log.push('数字は同じでした。');
      }
      break;
    }
    case 'veil': {
      player.protected = true;
      room.log.push(`${player.name} は次の自分の番まで守られます。`);
      break;
    }
    case 'patron': {
      if (!target || target.hand.length === 0) {
        return;
      }
      const discarded = target.hand.pop();
      target.discard.push(discarded);
      room.log.push(`${target.name} は ${discarded.name} を捨てました。`);
      if (discarded.key === 'sealedLetter') {
        eliminatePlayer(room, target, '密書を捨てたため脱落しました。');
      } else {
        const nextCard = draw(room.deck) || room.burnCard;
        room.burnCard = nextCard === room.burnCard ? null : room.burnCard;
        if (nextCard) {
          target.hand.push(nextCard);
        } else {
          eliminatePlayer(room, target, '引けるカードがありませんでした。');
        }
      }
      break;
    }
    case 'envoy': {
      if (!target || !target.hand[0] || !player.hand[0]) {
        return;
      }
      const targetHand = target.hand;
      target.hand = player.hand;
      player.hand = targetHand;
      room.log.push(`${player.name} と ${target.name} は手札を交換しました。`);
      break;
    }
    case 'archivist':
      room.log.push('記録官は静かに捨て札へ置かれました。');
      break;
    case 'sealedLetter':
      eliminatePlayer(room, player, '密書を捨てたため脱落しました。');
      break;
    default:
      break;
  }
}

function resolveRoundOrAdvance(room) {
  if (room.phase !== 'playing') {
    return;
  }

  const activePlayers = getActivePlayers(room);
  if (activePlayers.length <= 1) {
    endRound(room, activePlayers, '最後まで残りました。');
    return;
  }

  if (room.deck.length === 0) {
    const winners = chooseWinnersByHand(activePlayers);
    endRound(room, winners, '山札が尽きたため、残った手札で勝者を決めました。');
    return;
  }

  advanceTurn(room);
}

function endRound(room, winners, reason) {
  const finalWinners = winners.length > 0 ? winners : chooseWinnersByHand(getActivePlayers(room));
  finalWinners.forEach((winner) => {
    winner.score += 1;
  });

  room.roundWinnerIds = finalWinners.map((winner) => winner.id);
  const winnerNames = finalWinners.map((winner) => winner.name).join('、');
  room.log.push(`${reason} 勝者: ${winnerNames}`);

  const gameWinners = room.players.filter((player) => player.score >= room.targetScore);
  if (gameWinners.length > 0) {
    room.phase = 'gameOver';
    room.log.push(`${gameWinners.map((player) => player.name).join('、')} がゲームに勝利しました。`);
  } else {
    room.phase = 'roundOver';
  }
}

function advanceTurn(room) {
  const totalPlayers = room.players.length;
  for (let offset = 1; offset <= totalPlayers; offset += 1) {
    const nextIndex = (room.currentTurnIndex + offset) % totalPlayers;
    const nextPlayer = room.players[nextIndex];
    if (nextPlayer && !nextPlayer.eliminated && nextPlayer.connected) {
      room.currentTurnIndex = nextIndex;
      beginTurn(room);
      return;
    }
  }
}

function resolveTarget(room, player, cardType, targetId) {
  if (cardType.targetMode === 'none') {
    return { ok: true, player: null };
  }

  const eligibleTargets = getEligibleTargets(room, player, cardType);
  if (eligibleTargets.length === 0) {
    return { ok: true, player: null };
  }

  const target = eligibleTargets.find((entry) => entry.id === targetId);
  if (!target) {
    return { ok: false, error: '対象を選んでください。' };
  }

  return { ok: true, player: target };
}

function getEligibleTargets(room, player, cardType) {
  return room.players.filter((target) => {
    if (target.eliminated || !target.connected) {
      return false;
    }

    if (cardType.targetMode === 'opponent' && target.id === player.id) {
      return false;
    }

    if (target.protected && target.id !== player.id) {
      return false;
    }

    return true;
  });
}

function eliminatePlayer(room, player, reason) {
  if (player.eliminated) {
    return;
  }

  player.eliminated = true;
  player.protected = false;
  while (player.hand.length > 0) {
    player.discard.push(player.hand.pop());
  }
  room.log.push(`${player.name} は脱落しました。${reason}`);
}

function getForcedCard(hand) {
  if (hand.length < 2) {
    return null;
  }

  const archivist = hand.find((card) => card.key === 'archivist');
  const hasRiskyPartner = hand.some((card) => card.key === 'patron' || card.key === 'envoy');
  return archivist && hasRiskyPartner ? archivist : null;
}

function chooseWinnersByHand(players) {
  let bestValue = -1;
  let bestDiscardTotal = -1;
  let winners = [];

  players.forEach((player) => {
    const handValue = player.hand[0]?.value || 0;
    const discardTotal = player.discard.reduce((total, card) => total + card.value, 0);

    if (handValue > bestValue || (handValue === bestValue && discardTotal > bestDiscardTotal)) {
      bestValue = handValue;
      bestDiscardTotal = discardTotal;
      winners = [player];
      return;
    }

    if (handValue === bestValue && discardTotal === bestDiscardTotal) {
      winners.push(player);
    }
  });

  return winners;
}

function getCurrentPlayer(room) {
  return room.players[room.currentTurnIndex] || null;
}

function getActivePlayers(room) {
  return room.players.filter((player) => !player.eliminated && player.connected);
}

function buildDeck() {
  const deck = [];
  CARD_TYPES.forEach((cardType) => {
    for (let index = 0; index < cardType.count; index += 1) {
      deck.push({
        uid: `${cardType.key}-${index}-${crypto.randomUUID()}`,
        key: cardType.key,
        value: cardType.value,
        name: cardType.name,
        tone: cardType.tone,
        image: cardType.image
      });
    }
  });
  return deck;
}

function draw(deck) {
  return deck.pop() || null;
}

function shuffle(cards) {
  const shuffledCards = [...cards];
  for (let index = shuffledCards.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffledCards[index], shuffledCards[swapIndex]] = [shuffledCards[swapIndex], shuffledCards[index]];
  }
  return shuffledCards;
}

function broadcastRoomList() {
  io.emit('roomListUpdate', listRoomSummaries());
}

function listRoomSummaries() {
  return [...rooms.values()]
    .filter((room) => room.players.some((player) => player.connected))
    .sort((firstRoom, secondRoom) => secondRoom.createdAt - firstRoom.createdAt)
    .map((room) => {
      const connectedPlayers = room.players.filter((player) => player.connected);
      const host = room.players.find((player) => player.id === room.hostId) || connectedPlayers[0];

      return {
        code: room.code,
        hostName: host?.name || '不明',
        playerCount: connectedPlayers.length,
        maxPlayers: MAX_PLAYERS,
        phase: room.phase,
        round: room.round,
        locked: Boolean(room.password),
        joinable: room.phase === 'lobby' && connectedPlayers.length < MAX_PLAYERS,
        createdAt: room.createdAt
      };
    });
}

function broadcastRoom(room) {
  trimLog(room);
  room.players.forEach((player) => {
    io.to(player.id).emit('stateUpdate', serializeRoom(room, player.id));
  });
}

function serializeRoom(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  const shouldRevealHands = room.phase === 'roundOver' || room.phase === 'gameOver';
  const currentPlayer = getCurrentPlayer(room);

  return {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    targetScore: room.targetScore,
    hostId: room.hostId,
    currentPlayerId: currentPlayer?.id || null,
    deckCount: room.deck.length,
    roundWinnerIds: room.roundWinnerIds,
    lastPlayed: room.lastPlayed,
    log: room.log.slice(-18),
    rules: GAME_RULES,
    cardTypes: CARD_TYPES.map((card) => ({ ...card })),
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          hand: viewer.hand,
          insight: room.insights.get(viewer.id) || ''
        }
      : null,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isHost: player.id === room.hostId,
      connected: player.connected,
      eliminated: player.eliminated,
      protected: player.protected,
      handCount: player.hand.length,
      hand: player.id === viewerId || shouldRevealHands ? player.hand : [],
      discard: player.discard
    }))
  };
}

function trimLog(room) {
  if (room.log.length > 80) {
    room.log = room.log.slice(-80);
  }
}

function removePlayerFromRoom(room, playerId, reason) {
  const player = room.players.find((entry) => entry.id === playerId);
  room.players = room.players.filter((entry) => entry.id !== playerId);
  if (player) {
    room.log.push(`${player.name} が${reason}`);
  }

  if (room.hostId === playerId && room.players.length > 0) {
    room.hostId = room.players[0].id;
    room.log.push(`${room.players[0].name} が新しい部屋主になりました。`);
  }

  if (room.players.length === 0) {
    rooms.delete(room.code);
  }
}

function compactDisconnectedPlayers(room) {
  const originalCount = room.players.length;
  room.players = room.players.filter((player) => player.connected);
  if (room.players.length < originalCount) {
    room.log.push('切断済みのプレイヤーを部屋から外しました。');
  }
  assignHostIfNeeded(room);
}

function assignHostIfNeeded(room) {
  const currentHost = room.players.find((player) => player.id === room.hostId && player.connected);
  if (currentHost) {
    return;
  }

  const nextHost = room.players.find((player) => player.connected);
  if (nextHost) {
    room.hostId = nextHost.id;
    room.log.push(`${nextHost.name} が新しい部屋主になりました。`);
  }
}

function resetRoomToLobby(room, message) {
  room.phase = 'lobby';
  room.deck = [];
  room.burnCard = null;
  room.currentTurnIndex = 0;
  room.roundWinnerIds = [];
  room.lastPlayed = null;
  room.insights.clear();
  room.players.forEach((player) => {
    player.hand = [];
    player.discard = [];
    player.eliminated = false;
    player.protected = false;
    player.score = 0;
  });
  room.log.push(message);
}

function getSocketRoom(socket, requestedRoomCode) {
  const roomCode = normalizeRoomCode(requestedRoomCode || socket.data.roomCode);
  if (!roomCode || socket.data.roomCode !== roomCode) {
    return null;
  }
  return rooms.get(roomCode) || null;
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  do {
    code = '';
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (rooms.has(code));

  return code;
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function cleanName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 18);
}

function cleanPassword(password) {
  return String(password || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_PASSWORD_LENGTH);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function verifyRoomPassword(room, password) {
  if (!room.password || !password) {
    return false;
  }

  const candidateHash = crypto.scryptSync(password, room.password.salt, 32);
  const storedHash = Buffer.from(room.password.hash, 'hex');
  return storedHash.length === candidateHash.length && crypto.timingSafeEqual(storedHash, candidateHash);
}

function isRateLimited(socket, action, intervalMs) {
  const now = Date.now();
  const rateLimits = socket.data.rateLimits || {};
  const lastActionAt = rateLimits[action] || 0;

  if (now - lastActionAt < intervalMs) {
    return true;
  }

  rateLimits[action] = now;
  socket.data.rateLimits = rateLimits;
  return false;
}

server.listen(PORT, () => {
  console.log(`Love Letter inspired game running at http://localhost:${PORT}`);
});