const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const rooms = new Map();

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    game: room.game,
    type: room.type,
    count: room.members.length,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt
  };
}

function sendRooms() {
  const allRooms = Array.from(rooms.values()).map(publicRoom);
  io.emit("rooms-list", allRooms);
}

function getMember(room, socketId) {
  if (!room) return null;
  return room.members.find((member) => member.id === socketId) || null;
}

function sendMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const members = room.members.map((member) => ({
    ...member,
    voice: room.voiceUsers.has(member.id)
  }));

  io.to(roomId).emit("room-members", members);
}

function removeVoiceUser(socketId, roomId = null) {
  const entries = roomId ? [[roomId, rooms.get(roomId)]] : Array.from(rooms.entries());

  for (const [id, room] of entries) {
    if (!room) continue;

    if (room.voiceUsers && room.voiceUsers.has(socketId)) {
      const member = getMember(room, socketId);
      room.voiceUsers.delete(socketId);

      io.to(id).emit("voice-user-left", {
        id: socketId,
        nick: member ? member.nick : "Jogador"
      });

      sendMembers(id);
    }
  }
}

function removeMemberFromAllRooms(socketId, skipRoomId = null) {
  for (const [roomId, room] of rooms.entries()) {
    if (skipRoomId && roomId === skipRoomId) continue;

    removeVoiceUser(socketId, roomId);

    const before = room.members.length;
    room.members = room.members.filter((member) => member.id !== socketId);

    if (before !== room.members.length) {
      io.to(roomId).emit("server-message", {
        message: "Um jogador saiu da sala."
      });

      if (room.members.length > 0 && !room.members.some((member) => member.host)) {
        room.members[0].host = true;
      }

      sendMembers(roomId);
      sendRooms();
    }

    if (room.members.length === 0) {
      rooms.delete(roomId);
      sendRooms();
    }
  }
}

function joinRoom(socket, { roomId, nick, password }) {
  const room = rooms.get(roomId);

  if (!room) {
    socket.emit("join-error", { message: "Essa sala não existe mais." });
    return;
  }

  const cleanNick = String(nick || "Jogador").trim().slice(0, 24);
  const alreadyInThisRoom = room.members.some((member) => member.id === socket.id);

  if (alreadyInThisRoom) {
    socket.emit("joined-room", publicRoom(room));
    sendMembers(roomId);
    sendRooms();
    return;
  }

  if (room.members.length >= room.maxPlayers) {
    socket.emit("join-error", {
      message: "Essa sala já está cheia. Máximo de 5 jogadores."
    });
    return;
  }

  if (room.type === "private" && room.password !== String(password || "").trim()) {
    socket.emit("join-error", { message: "Senha da sala incorreta." });
    return;
  }

  removeMemberFromAllRooms(socket.id, roomId);

  socket.join(roomId);

  room.members.push({
    id: socket.id,
    nick: cleanNick,
    host: room.members.length === 0
  });

  socket.emit("joined-room", publicRoom(room));

  socket.emit("server-message", {
    message: `Bem-vindo(a), ${cleanNick}! Você entrou em ${room.name}.`
  });

  socket.to(roomId).emit("server-message", {
    message: `${cleanNick} entrou na sala.`
  });

  sendMembers(roomId);
  sendRooms();
}

function leaveRoom(socket, roomId, nick) {
  const room = rooms.get(roomId);
  if (!room) return;

  removeVoiceUser(socket.id, roomId);

  socket.leave(roomId);

  room.members = room.members.filter((member) => member.id !== socket.id);

  socket.to(roomId).emit("server-message", {
    message: `${nick || "Um jogador"} saiu da sala.`
  });

  if (room.members.length > 0 && !room.members.some((member) => member.host)) {
    room.members[0].host = true;
  }

  sendMembers(roomId);

  if (room.members.length === 0) {
    rooms.delete(roomId);
  }

  sendRooms();
}

function relayVoice(socket, eventName, { roomId, to, offer, answer, candidate }) {
  const room = rooms.get(roomId);
  if (!room) return;

  const fromMember = getMember(room, socket.id);
  const toMember = getMember(room, to);

  if (!fromMember || !toMember) return;

  const payload = {
    from: socket.id,
    nick: fromMember.nick
  };

  if (offer) payload.offer = offer;
  if (answer) payload.answer = answer;
  if (candidate) payload.candidate = candidate;

  io.to(to).emit(eventName, payload);
}

io.on("connection", (socket) => {
  console.log("Jogador conectado:", socket.id);

  socket.on("get-rooms", () => {
    const list = Array.from(rooms.values()).map(publicRoom);
    socket.emit("rooms-list", list);
  });

  socket.on("create-room", ({ game, name, type, password, nick }) => {
    const cleanName = String(name || "").trim().slice(0, 40);
    const cleanGame = String(game || "Minecraft").trim().slice(0, 30);
    const cleanType = type === "private" ? "private" : "public";
    const cleanPassword = String(password || "").trim().slice(0, 40);

    if (!cleanName) {
      socket.emit("join-error", { message: "Coloque um nome para a sala." });
      return;
    }

    if (cleanType === "private" && !cleanPassword) {
      socket.emit("join-error", { message: "Sala privada precisa de senha." });
      return;
    }

    const id = crypto.randomBytes(8).toString("hex");

    const room = {
      id,
      name: cleanName,
      game: cleanGame,
      type: cleanType,
      password: cleanPassword,
      maxPlayers: 5,
      members: [],
      voiceUsers: new Set(),
      createdAt: Date.now()
    };

    rooms.set(id, room);

    joinRoom(socket, {
      roomId: id,
      nick: nick || "Jogador",
      password: cleanPassword
    });

    sendRooms();
  });

  socket.on("join-room", (data) => {
    joinRoom(socket, data);
  });

  socket.on("leave-room", ({ roomId, nick }) => {
    leaveRoom(socket, roomId, nick);
  });

  socket.on("chat-message", ({ roomId, nick, text }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("join-error", { message: "Essa sala não existe mais." });
      return;
    }

    const isMember = room.members.some((member) => member.id === socket.id);

    if (!isMember) {
      socket.emit("join-error", { message: "Você não está nessa sala." });
      return;
    }

    const cleanText = String(text || "").trim().slice(0, 300);
    if (!cleanText) return;

    const time = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    io.to(roomId).emit("chat-message", {
      roomId,
      senderId: socket.id,
      nick: String(nick || "Jogador").slice(0, 24),
      text: cleanText,
      time
    });
  });

  socket.on("voice-join", ({ roomId, nick }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const member = getMember(room, socket.id);
    if (!member) return;

    room.voiceUsers.add(socket.id);

    const otherVoiceUsers = room.members
      .filter((memberItem) => room.voiceUsers.has(memberItem.id) && memberItem.id !== socket.id)
      .map((memberItem) => ({
        id: memberItem.id,
        nick: memberItem.nick
      }));

    socket.emit("voice-users", {
      users: otherVoiceUsers
    });

    socket.to(roomId).emit("voice-user-joined", {
      id: socket.id,
      nick: nick || member.nick
    });

    sendMembers(roomId);
  });

  socket.on("voice-leave", ({ roomId }) => {
    removeVoiceUser(socket.id, roomId);
  });

  socket.on("voice-offer", (data) => {
    relayVoice(socket, "voice-offer", data);
  });

  socket.on("voice-answer", (data) => {
    relayVoice(socket, "voice-answer", data);
  });

  socket.on("voice-ice", (data) => {
    relayVoice(socket, "voice-ice", data);
  });

  socket.on("disconnect", () => {
    console.log("Jogador desconectou:", socket.id);
    removeMemberFromAllRooms(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`GamerSync rodando na porta ${PORT}`);
});
