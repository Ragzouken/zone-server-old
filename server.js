const express = require("express");
const { exec } = require("child_process");

const youtube = require('./youtube');
const Playback = require('./playback');
const Messaging = require('./messaging');

const copy = object => JSON.parse(JSON.stringify(object));


  const app = express();
  const xws = require("express-ws")(app);

  // if someone tries to load the page, redirect to the client and tell it this zone's websocket endpoint
  app.get("/", (request, response) => {
    response.redirect(`https://kool.tools/zone/?zone=${process.env.PROJECT_DOMAIN}.glitch.me/zone`);
  });

  // this zone's websocket endpoint
  app.ws("/zone", (websocket, req) => createUser(websocket));

  app.listen(process.env.PORT || 8080);

let lastUserId = 0;
const connections = new Map();
const playback = new Playback();
const usernames = new Map();
const avatars = new Map();

playback.on('queue', video => sendAll('queue', { videos: [video] }));
playback.on('play', details => sendAll('youtube', details));
playback.on('stop', details => sendAll('youtube', {}))

let errors = 0;
playback.on('play', details => errors = 0);

const nameLengthLimit = 16;
const chatLengthLimit = 160;

function createUser(websocket) {
  const userId = ++lastUserId;

  const messaging = new Messaging(websocket);

  messaging.setHandler("heartbeat", message => websocket.ping());
  
  messaging.setHandler("chat", message => {
    let { text } = message;
    text = text.substring(0, chatLengthLimit);
    sendAll("chat", { text, userId });
  });

  messaging.setHandler("name", message => { 
    let { name } = message;
    name = name.substring(0, nameLengthLimit);
    if (!usernames.has(userId)) {
      avatars.set(userId, { position: [8, 15] });
      sendAll('move', { userId, position: [8, 15] });
    }
    
    usernames.set(userId, name);
    sendAll("name", { name, userId });
  });

  messaging.setHandler("youtube", message => {
    const { videoId } = message;
    playback.queueVideoById(videoId, { userId });
  });

  messaging.setHandler("search", message => {
    const { query } = message;
    youtube.search(query).then(results => {
      if (message.lucky)
        playback.queueVideoById(results[0].videoId, { userId });
      else
        sendOnly("search", { query, results }, userId);
    });
  });

  messaging.setHandler("skip", message => {
    if (message.password === process.env.SECRET || "") playback.skip();
  });
  
  messaging.setHandler("avatar", message => {
    const avatar = avatars.get(userId);
    if (!avatar) return;
    const { data } = message;
    avatar.data = data;
    sendAll('avatar', { data, userId });
  });
  
  messaging.setHandler('reboot', message => {
    const { master_key } = message;
    if (master_key === process.env.MASTER_KEY) {
      sendAll('status', { text: 'rebooting server' });
      exec("git pull && refresh");
    }
  });

  messaging.setHandler("error", message => {
    if (!playback.currentVideo || message.videoId !== playback.currentVideo.videoId)
      return;
    if (!usernames.get(userId))
      return;
    errors += 1;
    if (errors >= usernames.size / 2) {
      sendAll('status', { text: `skipping unplayable video ${playback.currentVideo.title}` })
      playback.skip();
    }
  });

  messaging.setHandler('move', message => {
    const avatar = avatars.get(userId);
    if (!avatar) return;
    const { position } = message;
    avatar.position = position;
    sendAll('move', { userId, position });
  });
  
  messaging.setHandler('emotes', message => {
    const avatar = avatars.get(userId);
    if (!avatar) return;
    const { emotes } = message;
    avatar.emotes = emotes;
    sendAll('emotes', {userId, emotes});
  });
  
  connections.set(userId, messaging);
  websocket.on("close", () => {
    const username = usernames.get(userId);
    connections.delete(userId);
    usernames.delete(userId);
    avatars.delete(userId);
    
    sendAll("leave", { userId });
    
    if (username)
      sendAll("status", { text: `${username} left`, userId: 0 });
  });

  sendOnly("assign", { userId }, userId);
  sendOnly('users', { names: Array.from(usernames) }, userId);
  sendOnly('queue', { videos: playback.queue }, userId);
  
  if (playback.currentVideo) {
    const video = copy(playback.currentVideo);
    video.time = playback.currentTime;
    sendOnly("youtube", video, userId);
  }

  avatars.forEach((avatar, user) => {
    sendOnly('move', { userId: user, position: avatar.position }, userId);
    sendOnly('emotes', {userId: user, emotes: avatar.emotes }, userId);
    sendOnly('avatar', {userId: user, data: avatar.data }, userId);
  });
  
  return userId;
}

function sendAll(type, message) {
  connections.forEach(connection => connection.send(type, message));
}

function sendExcept(type, message, userId) {
  connections.forEach((connection, user) => {
    if (user !== userId) connection.send(type, message);
  });
}

function sendOnly(type, message, userId) {
  connections.get(userId).send(type, message);
}
