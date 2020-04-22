import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { copy } from './utility';
import youtube, { YoutubeVideo } from './youtube';

export type PlaybackState = {
    current: YoutubeVideo | undefined;
    queue: YoutubeVideo[];
    time: number;
};

export default class Playback extends EventEmitter {
    public currentVideo: YoutubeVideo | undefined = undefined;
    public queue: YoutubeVideo[] = [];

    private currentBeginTime: number = 0;
    private currentEndTime: number = 0;
    private checkTimeout: NodeJS.Timeout | undefined;

    constructor() {
        super();
        this.clearVideo();
    }

    copyState(): PlaybackState {
        return {
            current: this.currentVideo,
            queue: this.queue,
            time: this.currentTime,
        };
    }

    loadState(data: PlaybackState) {
        if (data.current)
            this.setVideo(data.current, data.time / 1000);
        data.queue.forEach((video) => this.queueYoutube(video));
    }

    async queueYoutube(video: YoutubeVideo) {
        this.queue.push(video);
        this.emit('queue', video);
        this.check();
    }

    async queueYoutubeById(videoId: string, meta: unknown) {
        const details = await youtube.details(videoId);
        details.meta = meta;
        this.queueYoutube(details);
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
        if (next) this.playVideo(next);
        else this.clearVideo();
    }

    private playVideo(video: YoutubeVideo) {
        this.setVideo(video, 0);
    }

    private clearVideo() {
        if (this.currentVideo) this.emit('stop');
        this.setTime(0);
        this.currentVideo = undefined;
    }

    private check() {
        if (this.playing) {
            if (this.checkTimeout) clearTimeout(this.checkTimeout);
            this.checkTimeout = setTimeout(() => this.check(), this.remainingTime + 1000);
        } else {
            this.skip();
        }
    }

    private setVideo(video: YoutubeVideo, startSeconds = 0) {
        this.currentVideo = video;
        this.emit('play', copy(video));
        this.setTime(video.duration * 1000, startSeconds * 1000);
    }

    private setTime(duration: number, time = 0) {
        this.currentBeginTime = performance.now() - time;
        this.currentEndTime = this.currentBeginTime + duration;
        if (duration > 0) this.check();
    }
}
