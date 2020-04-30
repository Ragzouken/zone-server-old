import * as express from 'express';
import * as expressWs from 'express-ws';
import * as WebSocket from 'ws';
import * as low from 'lowdb';
import { exec } from 'child_process';

import { copy } from './utility';
import youtube, { YoutubeSource, YoutubeVideo } from './youtube';
import Playback, { QueuedMedia } from './playback';
import Messaging from './messaging';
import { ZoneState, UserId, UserState } from './zone';
import { nanoid } from 'nanoid';

const SECONDS = 1000;
const tileLengthLimit = 12;

export type HostOptions = {
    listenHandle: any;
    pingInterval: number;
    saveInterval: number;
    userTimeout: number;
    nameLengthLimit: number;
    chatLengthLimit: number;

    voteSkipThreshold: number;
    errorSkipThreshold: number;

    joinPassword?: string;
    skipPassword?: string;
    rebootPassword?: string;
};

export const DEFAULT_OPTIONS: HostOptions = {
    listenHandle: 0,
    pingInterval: 10 * SECONDS,
    saveInterval: 30 * SECONDS,
    userTimeout: 5 * SECONDS,
    nameLengthLimit: 16,
    chatLengthLimit: 160,

    voteSkipThreshold: 0.6,
    errorSkipThreshold: 0.4,
};

export function host(adapter: low.AdapterSync, options: Partial<HostOptions> = {}) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);

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

    const server = app.listen(opts.listenHandle);

    function ping() {
        xws.getWss().clients.forEach((websocket) => {
            try {
                websocket.ping();
            } catch (e) {
                console.log("couldn't ping", e);
            }
        });
    }

    setInterval(ping, opts.pingInterval);
    setInterval(save, opts.saveInterval);

    let lastUserId = 0;
    const tokenToUser = new Map<string, UserState>();
    const connections = new Map<UserId, Messaging>();
    const playback = new Playback();
    const zone = new ZoneState();

    load();

    function mediaToYoutube(media: QueuedMedia) {
        console.assert(media.source.type === 'youtube');
        return media as QueuedMedia<YoutubeSource>;
    }

    function queueToDetails(media: QueuedMedia) {
        return {
            videoId: mediaToYoutube(media).source.videoId,
            title: media.details.title,
            duration: media.details.duration / 1000,
            meta: { userId: media.queue.userId },
        };
    }

    playback.on('queue', (media: QueuedMedia) => sendAll('queue', { videos: [queueToDetails(media)] }));
    playback.on('play', (media: QueuedMedia) => sendAll('youtube', queueToDetails(media)));
    playback.on('stop', () => sendAll('youtube', {}));

    playback.on('queue', save);
    playback.on('play', save);

    const skips = new Set<UserId>();
    const errors = new Set<UserId>();
    playback.on('play', () => {
        errors.clear();
        skips.clear();
    });

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

    function voteError(videoId: string, user: UserState) {
        if (!playback.currentMedia) return;

        const video = queueToDetails(playback.currentMedia);
        if (videoId !== video.videoId) return;

        errors.add(user.userId);
        if (errors.size >= Math.floor(zone.users.size * opts.errorSkipThreshold)) {
            skip(`skipping unplayable video ${playback.currentMedia.details.title}`);
        }
    }

    function voteSkip(videoId: string, user: UserState, password?: string) {
        if (!playback.currentMedia) return;

        const video = queueToDetails(playback.currentMedia);
        if (videoId !== video.videoId) return;

        if (opts.skipPassword && password === opts.skipPassword) {
            playback.skip();
        } else {
            skips.add(user.userId);
            const current = skips.size;
            const target = Math.ceil(zone.users.size * opts.voteSkipThreshold);
            if (current >= target) {
                skip(`voted to skip ${playback.currentMedia.details.title}`);
            } else {
                sendAll('status', { text: `${current} of ${target} votes to skip` });
            }
        }
    }

    function skip(message?: string) {
        if (message) sendAll('status', { text: message });
        playback.skip();
    }

    function waitJoin(websocket: WebSocket, userIp: unknown) {
        const messaging = new Messaging(websocket);

        messaging.setHandler('join', (message) => {
            messaging.setHandler('join', () => {});

            const resume = message.token && tokenToUser.has(message.token);
            const authorised = resume || !opts.joinPassword || message.password === opts.joinPassword;

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
                    }, opts.userTimeout);
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
        user.name = name.substring(0, opts.nameLengthLimit);
        sendAll('name', { name: user.name, userId: user.userId });
    }

    function sendAllState(user: UserState) {
        const users = Array.from(zone.users.values());
        const names = users.map((user) => [user.userId, user.name]);

        sendOnly('users', { names, users }, user.userId);
        sendOnly('queue', { videos: playback.queue.map(queueToDetails) }, user.userId);

        if (playback.currentMedia) {
            const video = queueToDetails(playback.currentMedia) as any;
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
            text = text.substring(0, opts.chatLengthLimit);
            sendAll('chat', { text, userId: user.userId });
        });

        messaging.setHandler('name', (message: any) => setUserName(user, message.name));

        messaging.setHandler('resync', () => {
            if (playback.playing) {
                const video = copy(playback.currentMedia);
                video.time = playback.currentTime;
                sendOnly('youtube', video, user.userId);
            } else {
                sendOnly('youtube', {}, user.userId);
            }
        });

        async function tryQueueYoutubeById(videoId: string) {
            const youtubes = playback.queue.filter((media) => media.source.type === 'youtube') as QueuedMedia<
                YoutubeSource
            >[];
            const existing = youtubes.find((video) => video.source.videoId === videoId);
            const limit = 3;
            const count = playback.queue.filter((video) => video.queue.ip === userIp).length;

            if (existing) {
                sendOnly('status', { text: `'${existing.details.title}' is already queued` }, user.userId);
            } else if (count >= limit) {
                sendOnly('status', { text: `you already have ${count} videos in the queue` }, user.userId);
            } else {
                const media = await youtube.details(videoId);
                playback.queueMedia(media, { userId: user.userId, ip: userIp });
            }
        }

        messaging.setHandler('youtube', (message: any) => tryQueueYoutubeById(message.videoId));

        messaging.setHandler('search', (message: any) => {
            const { query } = message;

            function youtubeToDetails(video: YoutubeVideo) {
                return { 
                    title: video.details.title, 
                    duration: video.details.duration / 1000, 
                    videoId: video.source.videoId,
                }
            }

            youtube.search(query).then((results) => {
                if (message.lucky) tryQueueYoutubeById(results[0].source.videoId);
                else sendOnly('search', { query, results: results.map(youtubeToDetails) }, user.userId);
            });
        });

        messaging.setHandler('avatar', (message: any) => {
            const { data } = message;
            if (data.length > tileLengthLimit) return;
            user.avatar = data;
            sendAll('avatar', { data, userId: user.userId });
        });

        messaging.setHandler('reboot', (message: any) => {
            const { master_key } = message;
            if (opts.rebootPassword && master_key === opts.rebootPassword) {
                save();
                sendAll('status', { text: 'rebooting server' });
                exec('git pull && refresh');
            }
        });

        messaging.setHandler('error', (message: any) => voteError(message.videoId, user));
        messaging.setHandler('skip', (message: any) => voteSkip(message.videoId, user, message.password));

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
