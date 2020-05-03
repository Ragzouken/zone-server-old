import * as express from 'express';
import * as expressWs from 'express-ws';
import * as WebSocket from 'ws';
import * as low from 'lowdb';
import { exec } from 'child_process';

import youtube, { YoutubeVideo } from './youtube';
import Playback, { PlayableMedia, QueueItem, PlayableSource } from './playback';
import Messaging from './messaging';
import { ZoneState, UserId, UserState } from './zone';
import { nanoid } from 'nanoid';
import { archiveOrgToPlayable } from './archiveorg';
import { objEqual, copy } from './utility';

const SECONDS = 1000;
const tileLengthLimit = 12;

export type HostOptions = {
    listenHandle: any;
    pingInterval: number;
    saveInterval: number;
    userTimeout: number;
    nameLengthLimit: number;
    chatLengthLimit: number;

    perUserQueueLimit: number;
    voteSkipThreshold: number;
    errorSkipThreshold: number;

    joinPassword?: string;
    skipPassword?: string;
    rebootPassword?: string;
    
    playbackPaddingTime: number;
};

export const DEFAULT_OPTIONS: HostOptions = {
    listenHandle: 0,
    pingInterval: 10 * SECONDS,
    saveInterval: 30 * SECONDS,
    userTimeout: 5 * SECONDS,
    nameLengthLimit: 16,
    chatLengthLimit: 160,

    perUserQueueLimit: 3,
    voteSkipThreshold: 0.6,
    errorSkipThreshold: 0.4,

    playbackPaddingTime: 1 * SECONDS,
};

export class ZoneServerStuff {
    public readonly playback = new Playback();
    public readonly zone = new ZoneState();
}

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

    const stuff = new ZoneServerStuff();
    stuff.playback.paddingTime = opts.playbackPaddingTime;

    load();

    function queueToDetails(item: QueueItem) {
        let videoId = 'invalid';

        try {
            videoId = (item.media as YoutubeVideo).source.videoId;
        } catch (e) {}

        return {
            videoId,
            title: item.media.details.title,
            duration: item.media.details.duration / 1000,
            meta: { userId: item.info.userId },
        };
    }

    stuff.playback.on('queue', (item: QueueItem) => sendAll('queue', { items: [item] }));
    stuff.playback.on('play', (item: QueueItem) => sendAll('play', { item: sanitiseItem(item) }));
    stuff.playback.on('stop', () => sendAll('play', {}));

    stuff.playback.on('queue', save);
    stuff.playback.on('play', save);

    const skips = new Set<UserId>();
    const errors = new Set<UserId>();
    stuff.playback.on('play', () => {
        errors.clear();
        skips.clear();
    });

    function load() {
        stuff.playback.loadState(db.get('playback').value());
        youtube.loadState(db.get('youtube').value());
    }

    function save() {
        db.set('playback', stuff.playback.copyState()).write();
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
        const connections = userToConnections.get(user);
        const connectionless = !connections || connections.size === 0;
        return connectionless;
    }

    function killUser(user: UserState) {
        if (stuff.zone.users.has(user.userId)) sendAll('leave', { userId: user.userId });
        stuff.zone.users.delete(user.userId);
        connections.delete(user.userId);
        userToConnections.delete(user);
    }

    function voteError(source: PlayableSource, user: UserState) {
        if (!stuff.playback.currentItem || !objEqual(source, stuff.playback.currentItem.media.source)) return;

        errors.add(user.userId);
        if (errors.size >= Math.floor(stuff.zone.users.size * opts.errorSkipThreshold)) {
            skip(`skipping unplayable video ${stuff.playback.currentItem.media.details.title}`);
        }
    }

    function voteSkip(source: PlayableSource, user: UserState, password?: string) {
        if (!stuff.playback.currentItem || !objEqual(source, stuff.playback.currentItem.media.source)) return;

        if (opts.skipPassword && password === opts.skipPassword) {
            stuff.playback.skip();
        } else {
            skips.add(user.userId);
            const current = skips.size;
            const target = Math.ceil(stuff.zone.users.size * opts.voteSkipThreshold);
            if (current >= target) {
                skip(`voted to skip ${stuff.playback.currentItem.media.details.title}`);
            } else {
                sendAll('status', { text: `${current} of ${target} votes to skip` });
            }
        }
    }

    function skip(message?: string) {
        if (message) sendAll('status', { text: message });
        stuff.playback.skip();
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
            const user = resume ? tokenToUser.get(token)! : stuff.zone.getUser(++lastUserId as UserId);

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
                // console.log('resume user', user.userId, userIp);
            } else {
                // console.log('new user', user.userId, userIp);
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

    function sanitiseItem(item: QueueItem) {
        const sanitised = copy(item);
        delete sanitised.info.ip;
        return sanitised;
    }

    function sendCurrent(user: UserState) {
        if (stuff.playback.currentItem) {
            const item = sanitiseItem(stuff.playback.currentItem);
            sendOnly('play', { item, time: stuff.playback.currentTime }, user.userId);
        } else {
            sendOnly('play', {}, user.userId);
        }
    }

    function sendAllState(user: UserState) {
        const users = Array.from(stuff.zone.users.values());
        sendOnly('users', { users }, user.userId);
        sendOnly('queue', { items: stuff.playback.queue }, user.userId);
        sendCurrent(user);
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

        messaging.setHandler('resync', () => sendCurrent(user));

        async function tryQueueMedia(media: PlayableMedia) {
            const existing = stuff.playback.queue.find((queued) => objEqual(queued.media.source, media.source))?.media;
            const count = stuff.playback.queue.filter((item) => item.info.ip === userIp).length;

            if (existing) {
                sendOnly('status', { text: `'${existing.details.title}' is already queued` }, user.userId);
            } else if (count >= opts.perUserQueueLimit) {
                sendOnly('status', { text: `you already have ${count} videos in the queue` }, user.userId);
            } else {
                stuff.playback.queueMedia(media, { userId: user.userId, ip: userIp });
            }
        }

        async function tryQueueArchiveByPath(path: string) {
            tryQueueMedia(await archiveOrgToPlayable(path));
        }

        async function tryQueueYoutubeById(videoId: string) {
            tryQueueMedia(await youtube.details(videoId));
        }

        messaging.setHandler('youtube', (message: any) => tryQueueYoutubeById(message.videoId));
        messaging.setHandler('archive', (message: any) => tryQueueArchiveByPath(message.path));

        messaging.setHandler('search', (message: any) => {
            youtube.search(message.query).then((results) => {
                if (message.lucky) tryQueueMedia(results[0]);
                else sendOnly('search', { results }, user.userId);
            });
        });

        messaging.setHandler('avatar', (message: any) => {
            const { data } = message;
            if (data.length > tileLengthLimit) return;
            user.avatar = data;
            sendAll('avatar', { data, userId: user.userId });
        });

        messaging.setHandler('reboot', (message: any) => {
            const { password } = message;
            if (opts.rebootPassword && password === opts.rebootPassword) {
                save();
                sendAll('status', { text: 'rebooting server' });
                exec('git pull && refresh');
            }
        });

        messaging.setHandler('error', (message: any) => voteError(message.source, user));
        messaging.setHandler('skip', (message: any) => voteSkip(message.source, user, message.password));

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

    return { server, stuff };
}
