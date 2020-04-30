import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { copy } from './utility';

export type PlayableSource = { type: string };

export interface PlayableMetadata {
    title: string;
    duration: number;
}

export interface PlayableMedia<TSource extends PlayableSource = PlayableSource> {
    source: TSource;
    details: PlayableMetadata;
}

export type PlaybackState = {
    current: PlayableMedia | undefined;
    queue: PlayableMedia[];
    time: number;
};

export default class Playback extends EventEmitter {
    public currentMedia: PlayableMedia | undefined = undefined;
    public queue: PlayableMedia[] = [];

    private currentBeginTime: number = 0;
    private currentEndTime: number = 0;
    private checkTimeout: NodeJS.Timeout | undefined;

    constructor() {
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
        data.queue.forEach((media) => this.queueMedia(media));
    }

    queueMedia(media: PlayableMedia) {
        this.queue.push(media);
        this.emit('queue', media);
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

    private playMedia(media: PlayableMedia) {
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
            this.checkTimeout = setTimeout(() => this.check(), this.remainingTime + 1000);
        } else {
            this.skip();
        }
    }

    private setMedia(media: PlayableMedia, time = 0) {
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
