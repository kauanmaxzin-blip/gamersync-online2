const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const admin = require("firebase-admin");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Config web do Firebase para o navegador
const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || ""
};

// Credenciais do Firebase Admin para o servidor verificar o login real.
// No Render, coloque FIREBASE_SERVICE_ACCOUNT_BASE64 com o JSON da Service Account em base64.
// Se não usar base64, coloque FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY.
function initFirebaseAdmin() {
  if (admin.apps.length) return;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer
      .from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64")
      .toString("utf8");

    const serviceAccount = JSON.parse(json);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return;
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
    return;
  }

  console.warn("Firebase Admin não configurado. Login real não será verificado no servidor.");
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "demo"
  });
}

initFirebaseAdmin();

/*
  ADM ESCOLHIDO POR CONTA GOOGLE/FIREBASE

  Coloque aqui o EMAIL Google das contas que podem ser ADM.
  Não precisa de código. Se o email estiver na lista, vira ADM automático.
*/
const ADMIN_EMAILS = [
  "kauanmaxzin@gmail.com"
];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/config", (req, res) => {
  res.json({
    firebaseConfig: FIREBASE_WEB_CONFIG
  });
});

const rooms = new Map();

function normalizeName(name) {
  return String(name || "").trim();
}

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

function getSocketName(socket, fallback = "Jogador") {
  return normalizeName(socket.data?.account?.name || fallback).slice(0, 24) || "Jogador";
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

function adminRooms() {
  return Array.from(rooms.values()).map(publicRoom);
}


function updateAdminStatusFromAccount(socket) {
  const email = String(socket.data?.account?.email || "").toLowerCase();
  const isAdmin = ADMIN_EMAILS.map((item) => String(item).toLowerCase()).includes(email);

  socket.data.isAdmin = isAdmin;
  socket.data.adminEmail = isAdmin ? email : "";

  socket.emit("admin-status", {
    isAdmin,
    email
  });

  if (isAdmin) {
    socket.emit("admin-rooms-list", adminRooms());
  }
}

function emitAdminRooms() {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data && socket.data.isAdmin) {
      socket.emit("admin-rooms-list", adminRooms());
    }
  }
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
      emitAdminRooms();
    }

    if (room.members.length === 0) {
      rooms.delete(roomId);
      sendRooms();
      emitAdminRooms();
    }
  }
}

function joinRoom(socket, { roomId, nick, password }) {
  const room = rooms.get(roomId);

  if (!room) {
    socket.emit("join-error", { message: "Essa sala não existe mais." });
    return;
  }

  const cleanNick = getSocketName(socket, nick);
  const alreadyInThisRoom = room.members.some((member) => member.id === socket.id);

  if (alreadyInThisRoom) {
    socket.emit("joined-room", publicRoom(room));

  socket.emit("room-history", {
    roomId,
    messages: room.messages || []
  });
    sendMembers(roomId);
    sendRooms();
    emitAdminRooms();
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
    host: room.members.length === 0,
    googleEmail: socket.data?.account?.email || ""
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
  emitAdminRooms();
}

function leaveRoom(socket, roomId, nick) {
  const room = rooms.get(roomId);
  if (!room) return;

  removeVoiceUser(socket.id, roomId);

  socket.leave(roomId);

  const cleanNick = getSocketName(socket, nick);

  room.members = room.members.filter((member) => member.id !== socket.id);

  socket.to(roomId).emit("server-message", {
    message: `${cleanNick || "Um jogador"} saiu da sala.`
  });

  if (room.members.length > 0 && !room.members.some((member) => member.host)) {
    room.members[0].host = true;
  }

  sendMembers(roomId);

  if (room.members.length === 0) {
    rooms.delete(roomId);
  }

  sendRooms();
  emitAdminRooms();
}

function closeRoomByAdmin(socket, roomId) {
  if (!socket.data || !socket.data.isAdmin) {
    socket.emit("admin-action-result", {
      ok: false,
      message: "Você não é ADM."
    });
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    socket.emit("admin-action-result", {
      ok: false,
      message: "Essa sala não existe mais."
    });
    return;
  }

  io.to(roomId).emit("server-message", {
    message: "Essa sala foi fechada por um ADM."
  });

  io.to(roomId).emit("room-closed", {
    roomId,
    name: room.name
  });

  for (const member of room.members) {
    const memberSocket = io.sockets.sockets.get(member.id);
    if (memberSocket) {
      removeVoiceUser(member.id, roomId);
      memberSocket.leave(roomId);
    }
  }

  rooms.delete(roomId);

  sendRooms();
  emitAdminRooms();

  socket.emit("admin-action-result", {
    ok: true,
    message: "Sala fechada com sucesso."
  });
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

  socket.data.isAdmin = false;

  socket.emit("rooms-list", Array.from(rooms.values()).map(publicRoom));

  socket.on("register-google-account", async ({ idToken }) => {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);

      socket.data.account = {
        uid: decoded.uid,
        email: decoded.email || "",
        name: decoded.name || (decoded.email ? decoded.email.split("@")[0] : "Jogador"),
        picture: decoded.picture || ""
      };

      socket.emit("google-account-ok", {
        account: socket.data.account
      });

      updateAdminStatusFromAccount(socket);
      socket.emit("rooms-list", Array.from(rooms.values()).map(publicRoom));
    } catch (error) {
      console.error("Token Firebase inválido:", error.message);
      socket.emit("google-account-error", {
        message: "Sessão Firebase inválida ou expirada."
      });
    }
  });

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
      messages: [],
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
    emitAdminRooms();
  });

  socket.on("join-room", (data) => {
    joinRoom(socket, data);
  });

  socket.on("leave-room", ({ roomId, nick }) => {
    leaveRoom(socket, roomId, nick);
  });


  socket.on("get-room-history", ({ roomId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("room-history", { roomId, messages: [] });
      return;
    }

    const isMember = room.members.some((member) => member.id === socket.id);

    if (!isMember) {
      socket.emit("room-history", { roomId, messages: [] });
      return;
    }

    socket.emit("room-history", {
      roomId,
      messages: room.messages || []
    });
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

    const message = {
      roomId,
      senderId: socket.id,
      nick: getSocketName(socket, nick),
      text: cleanText,
      time,
      createdAt: Date.now()
    };

    if (!room.messages) room.messages = [];
    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }

    io.to(roomId).emit("chat-message", message);
  });

  socket.on("admin-login", () => {
    updateAdminStatusFromAccount(socket);
  });

  socket.on("admin-logout", () => {
    socket.data.isAdmin = false;
    socket.data.adminEmail = "";
    socket.emit("admin-status", {
      isAdmin: false
    });
  });

  socket.on("admin-get-rooms", () => {
    if (!socket.data || !socket.data.isAdmin) {
      socket.emit("admin-action-result", {
        ok: false,
        message: "Você não é ADM."
      });
      return;
    }

    socket.emit("admin-rooms-list", adminRooms());
  });

  socket.on("admin-close-room", ({ roomId }) => {
    closeRoomByAdmin(socket, roomId);
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
