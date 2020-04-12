import * as express from 'express';
import * as expressWs from 'express-ws';
import * as WebSocket from 'ws';
import { exec } from 'child_process';

import youtube, { YoutubeVideo } from './youtube';
import Playback from './playback';
import Messaging from './messaging';

const copy = (object: any) => JSON.parse(JSON.stringify(object));

const xws = expressWs(express());
const app = xws.app;

// if someone tries to load the page, redirect to the client and tell it this zone's websocket endpoint
app.get('/', (request, response) => {
    response.redirect(`https://kool.tools/zone/?zone=${process.env.PROJECT_DOMAIN}.glitch.me/zone`);
});

// this zone's websocket endpoint
app.ws('/zone', (websocket, req) => {
    const userId = createUser(websocket);
    const ip = (req.headers['x-forwarded-for'] as string).split(/\s*,\s*/)[0];
    console.log('new user', userId, ip);
});

const server = app.listen(process.env.PORT || 8080, () => console.log('listening...'));

type UserId = unknown;

let lastUserId = 0;
const connections = new Map<UserId, any>();
const playback = new Playback();
const usernames = new Map<UserId, string>();
const avatars = new Map<UserId, any>();

playback.on('queue', (details: YoutubeVideo) => sendAll('queue', { videos: [details] }));
playback.on('play', (details: YoutubeVideo) => sendAll('youtube', details));
playback.on('stop', () => sendAll('youtube', {}));

let errors = 0;
playback.on('play', (details: YoutubeVideo) => (errors = 0));

const nameLengthLimit = 16;
const chatLengthLimit = 160;

function createUser(websocket: WebSocket) {
    const userId = ++lastUserId as UserId;

    const messaging = new Messaging(websocket);

    messaging.setHandler('heartbeat', () => {
        websocket.ping();
        sendOnly('heartbeat', {}, userId);
    });

    messaging.setHandler('chat', (message: any) => {
        let { text } = message;
        text = text.substring(0, chatLengthLimit);
        sendAll('chat', { text, userId });
    });

    messaging.setHandler('name', (message: any) => {
        let { name } = message;
        name = name.substring(0, nameLengthLimit);
        if (!usernames.has(userId)) {
            avatars.set(userId, { position: [8, 15] });
            sendAll('move', { userId, position: [8, 15] });
        }

        usernames.set(userId, name);
        sendAll('name', { name, userId });
    });

    messaging.setHandler('youtube', (message: any) => {
        const { videoId } = message;
        playback.queueVideoById(videoId, { userId });
    });

    messaging.setHandler('search', (message: any) => {
        const { query } = message;
        youtube.search(query).then((results) => {
            if (message.lucky) playback.queueVideoById(results[0].videoId, { userId });
            else sendOnly('search', { query, results }, userId);
        });
    });

    messaging.setHandler('skip', (message: any) => {
        if (message.password === process.env.SECRET || '') playback.skip();
    });

    messaging.setHandler('avatar', (message: any) => {
        const avatar = avatars.get(userId);
        if (!avatar) return;
        const { data } = message;
        avatar.data = data;
        sendAll('avatar', { data, userId });
    });

    messaging.setHandler('reboot', (message: any) => {
        const { master_key } = message;
        if (master_key === process.env.MASTER_KEY) {
            sendAll('status', { text: 'rebooting server' });
            exec('git pull && refresh');
        }
    });

    messaging.setHandler('error', (message: any) => {
        if (!playback.currentVideo || message.videoId !== playback.currentVideo.videoId) return;
        if (!usernames.get(userId)) return;
        errors += 1;
        if (errors >= usernames.size / 2) {
            sendAll('status', {
                text: `skipping unplayable video ${playback.currentVideo.title}`,
            });
            playback.skip();
        }
    });

    messaging.setHandler('move', (message: any) => {
        const avatar = avatars.get(userId);
        if (!avatar) return;
        const { position } = message;
        avatar.position = position;
        sendAll('move', { userId, position });
    });

    messaging.setHandler('emotes', (message: any) => {
        const avatar = avatars.get(userId);
        if (!avatar) return;
        const { emotes } = message;
        avatar.emotes = emotes;
        sendAll('emotes', { userId, emotes });
    });

    connections.set(userId, messaging);
    websocket.on('close', () => {
        const username = usernames.get(userId);
        connections.delete(userId);
        usernames.delete(userId);
        avatars.delete(userId);

        sendAll('leave', { userId });

        if (username) sendAll('status', { text: `${username} left`, userId: 0 });
    });

    sendOnly('assign', { userId }, userId);
    sendOnly('users', { names: Array.from(usernames) }, userId);
    sendOnly('queue', { videos: playback.queue }, userId);

    if (playback.currentVideo) {
        const video = copy(playback.currentVideo);
        video.time = playback.currentTime;
        sendOnly('youtube', video, userId);
    }

    avatars.forEach((avatar, user) => {
        sendOnly('move', { userId: user, position: avatar.position }, userId);
        sendOnly('emotes', { userId: user, emotes: avatar.emotes }, userId);
        sendOnly('avatar', { userId: user, data: avatar.data }, userId);
    });

    return userId;
}

function sendAll(type: string, message: any) {
    connections.forEach((connection) => connection.send(type, message));
}

function sendOnly(type: string, message: any, userId: UserId) {
    connections.get(userId).send(type, message);
}