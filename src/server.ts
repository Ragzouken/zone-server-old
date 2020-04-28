import * as express from 'express';
import * as expressWs from 'express-ws';
import * as WebSocket from 'ws';
import * as low from 'lowdb';
import { exec } from 'child_process';

import { copy } from './utility';
import youtube, { YoutubeVideo } from './youtube';
import Playback from './playback';
import Messaging from './messaging';
import { ZoneState, UserId, UserState } from './zone';
import { nanoid } from 'nanoid';

const pingInterval = 10 * 1000;
const saveInterval = 30 * 1000;
const userTimeout = 5 * 1000;
const nameLengthLimit = 16;
const chatLengthLimit = 160;
const tileLengthLimit = 12;

export function host(adapter: low.AdapterSync) {
    const db = low(adapter);
    db.defaults({
        playback: { current: undefined, queue: [], time: 0 },
        youtube: { videos: [] },
    }).write();

    const xws = expressWs(express());
    const app = xws.app;

    app.set('trust proxy', true);

    // if someone tries to load the page, redirect to the client and tell it this zone's websocket endpoint
    app.get('/', (request, response) => {
        response.redirect(`https://kool.tools/zone/?zone=${process.env.PROJECT_DOMAIN}.glitch.me/zone`);
    });

    // this zone's websocket endpoint
    app.ws('/zone', (websocket, req) => waitJoin(websocket, req.ip));

    const server = app.listen(process.env.PORT || 8080, () => console.log('listening...'));

    function ping() {
        xws.getWss().clients.forEach((websocket) => {
            try {
                websocket.ping();
            } catch (e) {
                console.log("couldn't ping", e);
            }
        });
    }

    setInterval(ping, pingInterval);

    let lastUserId = 0;
    const tokenToUser = new Map<string, UserState>();
    const connections = new Map<UserId, Messaging>();
    const playback = new Playback();
    const zone = new ZoneState();

    load();

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

    setInterval(save, saveInterval);

    function load() {
        playback.loadState(db.get('playback').value());
        youtube.loadState(db.get('youtube').value());
    }

    function save() {
        db.set('playback', playback.copyState()).write();
        db.set('youtube', youtube.copyState()).write();
    }

    const userToConnections = new Map<UserState, Set<Messaging>>();
    function addConnectionToUser(user: UserState, messaging: Messaging) {
        const connections = userToConnections.get(user) || new Set<Messaging>();
        connections.add(messaging);
        userToConnections.set(user, connections);
    }

    function removeConnectionFromUser(user: UserState, messaging: Messaging) {
        userToConnections.get(user)?.delete(messaging);
    }

    function isUserConnectionless(user: UserState) {
        const connections = userToConnections.get(user)!;
        const connectionless = connections.size === 0;
        return connectionless;
    }

    function killUser(user: UserState) {
        if (zone.users.has(user.userId)) sendAll('leave', { userId: user.userId });
        zone.users.delete(user.userId);
        connections.delete(user.userId);
        userToConnections.delete(user);
    }

    function waitJoin(websocket: WebSocket, userIp: unknown) {
        const messaging = new Messaging(websocket);

        messaging.setHandler('join', (message) => {
            messaging.setHandler('join', () => {});
            console.log(message);

            const resume = message.token && tokenToUser.has(message.token);
            const authorised = resume || !process.env.join_password || message.password === process.env.join_password;

            if (!authorised) {
                messaging.send('reject', { text: 'rejected: password required' });
                websocket.close(4000);
                return;
            }

            const token = resume ? message.token : nanoid();
            const user = resume ? tokenToUser.get(token)! : zone.getUser(++lastUserId as UserId);

            tokenToUser.set(token, user);
            addConnectionToUser(user, messaging);

            bindMessagingToUser(user, messaging, userIp);
            connections.set(user.userId, messaging);

            websocket.on('close', (code: number) => {
                removeConnectionFromUser(user, messaging);
                const cleanExit = code === 1000 || code === 1001;

                if (cleanExit) {
                    killUser(user);
                } else {
                    setTimeout(() => {
                        if (isUserConnectionless(user)) killUser(user);
                    }, userTimeout);
                }
            });

            if (resume) {
                console.log('resume user', user.userId, userIp);
            } else {
                console.log('new user', user.userId, userIp);
            }

            sendAllState(user);
            sendOnly('assign', { userId: user.userId, token }, user.userId);
            if (!resume) setUserName(user, message.name);
        });
    }

    function setUserName(user: UserState, name: string) {
        user.name = name.substring(0, nameLengthLimit);
        sendAll('name', { name: user.name, userId: user.userId });
    }

    function sendAllState(user: UserState) {
        const users = Array.from(zone.users.values());
        const names = users.map((user) => [user.userId, user.name]);

        sendOnly('users', { names, users }, user.userId);
        sendOnly('queue', { videos: playback.queue }, user.userId);

        if (playback.currentVideo) {
            const video = copy(playback.currentVideo);
            video.time = playback.currentTime;
            sendOnly('youtube', video, user.userId);
        }
    }

    function bindMessagingToUser(user: UserState, messaging: Messaging, userIp: unknown) {
        messaging.setHandler('heartbeat', () => {
            sendOnly('heartbeat', {}, user.userId);
        });

        messaging.setHandler('chat', (message: any) => {
            let { text } = message;
            text = text.substring(0, chatLengthLimit);
            sendAll('chat', { text, userId: user.userId });
        });

        messaging.setHandler('name', (message: any) => setUserName(user, message.name));

        messaging.setHandler('resync', () => {
            if (playback.playing) {
                const video = copy(playback.currentVideo);
                video.time = playback.currentTime;
                sendOnly('youtube', video, user.userId);
            } else {
                sendOnly('youtube', {}, user.userId);
            }
        });

        function tryQueue(videoId: string) {
            const existing = playback.queue.find((video) => video.videoId === videoId);
            const limit = 3;
            const count = playback.queue.filter((video) => video.meta.ip === userIp).length;

            if (existing) {
                sendOnly('status', { text: `'${existing.title}' is already queued` }, user.userId);
            } else if (count >= limit) {
                sendOnly('status', { text: `you already have ${count} videos in the queue` }, user.userId);
            } else {
                playback.queueYoutubeById(videoId, { userId: user.userId, ip: userIp });
            }
        }

        messaging.setHandler('youtube', (message: any) => tryQueue(message.videoId));

        messaging.setHandler('search', (message: any) => {
            const { query } = message;
            youtube.search(query).then((results) => {
                if (message.lucky) tryQueue(results[0].videoId);
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
                const target = Math.ceil(zone.users.size * 0.6);
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
    }

    function sendAll(type: string, message: any) {
        connections.forEach((connection) => connection.send(type, message));
    }

    function sendOnly(type: string, message: any, userId: UserId) {
        connections.get(userId)!.send(type, message);
    }

    return server;
}
