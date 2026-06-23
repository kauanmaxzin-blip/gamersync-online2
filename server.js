const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

// Serve os arquivos do app
app.use(express.static(__dirname));

// Abre o app na página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const rooms = new Map();

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      name: roomName,
      game: "Minecraft",
      type: "public",
      password: "",
      members: []
    });
  }

  return rooms.get(roomName);
}

function sendMembers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;

  io.to(roomName).emit("room-members", room.members);
}

function removeMember(socketId) {
  for (const [roomName, room] of rooms.entries()) {
    const before = room.members.length;

    room.members = room.members.filter((member) => member.id !== socketId);

    if (before !== room.members.length) {
      io.to(roomName).emit("server-message", {
        message: "Um jogador saiu da sala."
      });

      sendMembers(roomName);
    }

    if (room.members.length === 0) {
      rooms.delete(roomName);
    }
  }
}

io.on("connection", (socket) => {
  console.log("Jogador conectado:", socket.id);

  socket.on("join-room", ({ room, game, nick, type, password }) => {
    if (!room || !nick) return;

    const roomData = getRoom(room);

    if (roomData.members.length >= 5) {
      socket.emit("server-message", {
        message: "Essa sala já está cheia. Máximo de 5 jogadores."
      });
      return;
    }

    if (roomData.members.length === 0) {
      roomData.game = game || "Minecraft";
      roomData.type = type || "public";
      roomData.password = password || "";
    }

    if (
      roomData.type === "private" &&
      roomData.password &&
      password !== roomData.password
    ) {
      socket.emit("server-message", {
        message: "Senha da sala incorreta."
      });
      return;
    }

    socket.join(room);

    const alreadyInRoom = roomData.members.some(
      (member) => member.id === socket.id
    );

    if (!alreadyInRoom) {
      roomData.members.push({
        id: socket.id,
        nick,
        host: roomData.members.length === 0
      });
    }

    socket.emit("server-message", {
      message: `Bem-vindo(a), ${nick}! Você entrou em ${room}.`
    });

    socket.to(room).emit("server-message", {
      message: `${nick} entrou na sala.`
    });

    sendMembers(room);
  });

  socket.on("leave-room", ({ room, nick }) => {
    if (!room) return;

    socket.leave(room);

    const roomData = rooms.get(room);

    if (roomData) {
      roomData.members = roomData.members.filter(
        (member) => member.id !== socket.id
      );

      socket.to(room).emit("server-message", {
        message: `${nick || "Um jogador"} saiu da sala.`
      });

      sendMembers(room);

      if (roomData.members.length === 0) {
        rooms.delete(room);
      }
    }
  });

  socket.on("chat-message", ({ room, nick, text }) => {
    if (!room || !nick || !text) return;

    const cleanText = String(text).slice(0, 300);

    const time = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    io.to(room).emit("chat-message", {
      nick,
      text: cleanText,
      time
    });
  });

  socket.on("disconnect", () => {
    console.log("Jogador desconectou:", socket.id);
    removeMember(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`GamerSync rodando na porta ${PORT}`);
});
