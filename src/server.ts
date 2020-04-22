import * as express from 'express';
import * as expressWs from 'express-ws';
import * as WebSocket from 'ws';
import * as FileSync from 'lowdb/adapters/FileSync';
import * as low from 'lowdb';
import { exec } from 'child_process'
import { nanoid } from 'nanoid';

import { copy } from './utility';
import youtube, { YoutubeVideo } from './youtube';
import Playback from './playback';
import Messaging from './messaging';
import { ZoneState, UserId } from './zone';

const xws = expressWs(express());
const app = xws.app;

const adapter = new FileSync('.data/db.json');
const db = low(adapter);
db.defaults({
    playback: { current: undefined, queue: [], time: 0 },
}).write();

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

let lastUserId = 0;
const connections = new Map<UserId, Messaging>();
const playback = new Playback();
const zone = new ZoneState();

playback.loadState(db.get('playback').value());

playback.on('queue', (details: YoutubeVideo) => sendAll('queue', { videos: [details] }));
playback.on('play', (details: YoutubeVideo) => sendAll('youtube', details));
playback.on('stop', () => sendAll('youtube', {}));

playback.on('queue', save);
playback.on('play', save);

const skips = new Set<UserId>();
const errors = new Set<UserId>();
playback.on('play', () => {
    errors.clear();
    skips.clear();
});

const nameLengthLimit = 16;
const chatLengthLimit = 160;
const tileLengthLimit = 12;

setInterval(save, 30 * 1000);

function save() {
    db.set('playback', playback.copyState()).write();
}

setInterval(ping, 20 * 1000);

function ping() {
    xws.getWss().clients.forEach(websocket => {
        try {
            websocket.ping();
        } catch (e) {
            console.log("couldn't ping", e);
        }
    });
}

function createUser(websocket: WebSocket) {
    websocket.on('ping', data => console.log('pinged', data));

    const user = zone.getUser(++lastUserId as UserId);
    const token = nanoid();

    const messaging = new Messaging(websocket);

    messaging.setHandler('heartbeat', () => {
        sendOnly('heartbeat', {}, user.userId);
    });

    messaging.setHandler('chat', (message: any) => {
        let { text } = message;
        text = text.substring(0, chatLengthLimit);
        sendAll('chat', { text, userId: user.userId });
    });

    messaging.setHandler('name', (message: any) => {
        const { name } = message;
        user.name = name.substring(0, nameLengthLimit);
        sendAll('name', { name: user.name, userId: user.userId });
    });

    messaging.setHandler('resync', () => {
        const video = copy(playback.currentVideo);
        video.time = playback.currentTime;
        sendOnly('youtube', video, user.userId);
    });
    
    messaging.setHandler('youtube', (message: any) => {
        if (message.video) {
            message.video.meta = { userId: user.userId };
            playback.queueYoutube(message.video);
        } else {
            const { videoId } = message;
            playback.queueYoutubeById(videoId, { userId: user.userId });
        }
    });

    messaging.setHandler('search', (message: any) => {
        const { query } = message;
        youtube.search(query).then((results) => {
            if (message.lucky) playback.queueYoutubeById(results[0].videoId, { userId: user.userId });
            else sendOnly('search', { query, results }, user.userId);
        });
    });

    messaging.setHandler('skip', (message: any) => {
        if (message.videoId !== playback.currentVideo?.videoId) return;
        
        if (message.password === process.env.SECRET || '') {
            playback.skip();
        } else {
            skips.add(user.userId);
            const current = skips.size;
            const target = Math.ceil(zone.users.size * .6);
            if (current >= target) {
                sendAll('status', { text: `voted to skip ${playback.currentVideo?.title}` });
                playback.skip();
            } else {
                sendAll('status', { text: `${current} of ${target} votes to skip` });
            }
        }
    });

    messaging.setHandler('avatar', (message: any) => {
        const { data } = message;
        if (data.length > tileLengthLimit) return;
        user.avatar = data;
        sendAll('avatar', { data, userId: user.userId });
    });

    messaging.setHandler('reboot', (message: any) => {
        const { master_key } = message;
        if (master_key === process.env.MASTER_KEY) {
            save();
            sendAll('status', { text: 'rebooting server' });
            exec('git pull && refresh');
        }
    });

    messaging.setHandler('error', (message: any) => {
        if (!playback.currentVideo || message.videoId !== playback.currentVideo.videoId) return;
        if (!user.name) return;
        errors.add(user.userId);
        if (errors.size > zone.users.size / 2) {
            sendAll('status', {
                text: `skipping unplayable video ${playback.currentVideo.title}`,
            });
            playback.skip();
        }
    });

    messaging.setHandler('move', (message: any) => {
        const { position } = message;
        user.position = position;
        sendAll('move', { userId: user.userId, position });
    });

    messaging.setHandler('emotes', (message: any) => {
        const { emotes } = message;
        user.emotes = emotes;
        sendAll('emotes', { userId: user.userId, emotes });
    });

    connections.set(user.userId, messaging);
    websocket.on('close', () => {
        zone.users.delete(user.userId);
        connections.delete(user.userId);
        sendAll('leave', { userId: user.userId });

        if (user.name) 
            sendAll('status', { text: `${user.name} left` });
    });

    const users = Array.from(zone.users.values());
    const names = users.map(u => [u.userId, u.name]);

    sendOnly('assign', { userId: user.userId, token }, user.userId);
    sendOnly('users', { names, users }, user.userId);
    sendOnly('queue', { videos: playback.queue }, user.userId);

    if (playback.currentVideo) {
        const video = copy(playback.currentVideo);
        video.time = playback.currentTime;
        sendOnly('youtube', video, user.userId);
    }

    zone.users.forEach((user, userId) => {
        if (user.position) sendOnly('move', { userId, position: user.position }, user.userId);
        if (user.emotes) sendOnly('emotes', { userId, emotes: user.emotes }, user.userId);
        if (user.avatar) sendOnly('avatar', { userId, data: user.avatar }, user.userId);
    });

    return user.userId;
}

function sendAll(type: string, message: any) {
    connections.forEach((connection) => connection.send(type, message));
}

function sendOnly(type: string, message: any, userId: UserId) {
    connections.get(userId)!.send(type, message);
}
