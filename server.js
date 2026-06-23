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

function sendRooms(game = null) {
  const allRooms = Array.from(rooms.values())
    .filter((room) => !game || room.game === game)
    .map(publicRoom);

  io.emit("rooms-list", allRooms);
}

function sendMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit("room-members", room.members);
}

function removeMemberFromAllRooms(socketId, skipRoomId = null) {
  for (const [roomId, room] of rooms.entries()) {
    if (skipRoomId && roomId === skipRoomId) continue;

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
      sendRooms(room.game);
    }

    if (room.members.length === 0) {
      rooms.delete(roomId);
      sendRooms(room.game);
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
    sendRooms(room.game);
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

  // O jogador fica em apenas uma sala por vez,
  // mas não apagamos a sala que ele acabou de criar/entrar.
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
  sendRooms(room.game);
}

function leaveRoom(socket, roomId, nick) {
  const room = rooms.get(roomId);
  if (!room) return;

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

  sendRooms(room.game);
}

io.on("connection", (socket) => {
  console.log("Jogador conectado:", socket.id);

  socket.on("get-rooms", ({ game } = {}) => {
    const list = Array.from(rooms.values())
      .filter((room) => !game || room.game === game)
      .map(publicRoom);

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
      createdAt: Date.now()
    };

    rooms.set(id, room);

    // O criador entra uma única vez na sala.
    joinRoom(socket, {
      roomId: id,
      nick: nick || "Jogador",
      password: cleanPassword
    });

    sendRooms(cleanGame);
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

    // Aqui está o principal:
    // a mensagem vai SOMENTE para quem está dentro dessa sala.
    io.to(roomId).emit("chat-message", {
      roomId,
      senderId: socket.id,
      nick: String(nick || "Jogador").slice(0, 24),
      text: cleanText,
      time
    });
  });

  socket.on("disconnect", () => {
    console.log("Jogador desconectou:", socket.id);
    removeMemberFromAllRooms(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`GamerSync rodando na porta ${PORT}`);
});
