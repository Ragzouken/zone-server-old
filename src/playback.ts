import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { copy } from './utility';
import { UserId } from './zone';

export type PlayableSource = { type: string };

export interface PlayableMetadata {
    title: string;
    duration: number;
}

export interface PlayableMedia<TSource extends PlayableSource = PlayableSource> {
    source: TSource;
    details: PlayableMetadata;
}

export type QueueInfo = { userId?: UserId; ip?: unknown };
export interface QueuedMedia<TSource extends PlayableSource = PlayableSource> extends PlayableMedia<TSource> {
    queue: QueueInfo;
}

export type PlaybackState = {
    current?: QueuedMedia;
    queue: QueuedMedia[];
    time: number;
};

export interface Playback {
    on(event: 'play' | 'queue', callback: (media: QueuedMedia) => void): this;
    on(event: 'stop', callback: () => void): this;
}

export class Playback extends EventEmitter {
    public currentMedia?: QueuedMedia;
    public queue: QueuedMedia[] = [];

    private currentBeginTime: number = 0;
    private currentEndTime: number = 0;
    private checkTimeout: NodeJS.Timeout | undefined;

    constructor(public paddingTime = 0) {
        super();
        this.clearMedia();
    }

    copyState(): PlaybackState {
        return {
            current: this.currentMedia,
            queue: this.queue,
            time: this.currentTime,
        };
    }

    loadState(data: PlaybackState) {
        if (data.current) this.setMedia(data.current, data.time);
        data.queue.forEach((media) => this.queueMedia(media, media.queue));
    }

    queueMedia(media: PlayableMedia, info: QueueInfo = {}) {
        const queued = Object.assign(media, { queue: info });
        this.queue.push(queued);
        this.emit('queue', queued);
        this.check();
    }

    get playing() {
        return this.remainingTime > 0;
    }

    get currentTime() {
        return performance.now() - this.currentBeginTime;
    }

    get remainingTime() {
        return Math.max(0, this.currentEndTime - performance.now());
    }

    skip() {
        const next = this.queue.shift();
        if (next) this.playMedia(next);
        else this.clearMedia();
    }

    private playMedia(media: QueuedMedia) {
        this.setMedia(media, 0);
    }

    private clearMedia() {
        if (this.currentMedia) this.emit('stop');
        this.setTime(0);
        this.currentMedia = undefined;
    }

    private check() {
        if (this.playing) {
            if (this.checkTimeout) clearTimeout(this.checkTimeout);
            this.checkTimeout = setTimeout(() => this.check(), this.remainingTime + this.paddingTime);
        } else {
            this.skip();
        }
    }

    private setMedia(media: QueuedMedia, time = 0) {
        this.currentMedia = media;
        this.setTime(media.details.duration, time);
        this.emit('play', copy(media));
    }

    private setTime(duration: number, time = 0) {
        this.currentBeginTime = performance.now() - time;
        this.currentEndTime = this.currentBeginTime + duration;
        if (duration > 0) this.check();
    }
}

export default Playback;
