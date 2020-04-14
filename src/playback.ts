import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { copy } from './utility';
import youtube, { YoutubeVideo } from './youtube';

export type PlaybackState = {
    current: YoutubeVideo | undefined,
    queue: YoutubeVideo[],
    time: number,
};

export default class Playback extends EventEmitter {
    public currentVideo: YoutubeVideo | undefined = undefined;
    public queue: YoutubeVideo[] = [];

    private currentBeginTime: number = 0;
    private currentEndTime: number = 0;

    constructor() {
        super();
        this.clearVideo();
    }

    copyState(): PlaybackState {
        return {
            current: this.currentVideo,
            queue: this.queue,
            time: this.currentTime,
        }
    }

    loadState(data: PlaybackState) {
        this.currentVideo = data.current;
        this.currentBeginTime = performance.now() - data.time;
        data.queue.forEach(video => this.queueYoutube(video));
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

    get idle() {
        return performance.now() >= this.currentEndTime;
    }

    get currentTime() {
        return performance.now() - this.currentBeginTime;
    }

    skip() {
        const next = this.queue.shift();
        if (next) this.playVideo(next);
        else this.clearVideo();
    }

    private playVideo(video: YoutubeVideo) {
        this.currentBeginTime = performance.now();
        this.currentEndTime = this.currentBeginTime + video.duration * 1000;
        this.currentVideo = video;
        const message = copy(video);
        message.time = 0;
        this.emit('play', message);
        setTimeout(() => this.check(), (video.duration + 1) * 1000);
    }

    private clearVideo() {
        if (this.currentVideo) this.emit('stop');
        this.currentBeginTime = performance.now();
        this.currentEndTime = performance.now();
        this.currentVideo = undefined;
    }

    private check() {
        if (!this.idle) return;

        const next = this.queue.shift();
        if (next) {
            this.playVideo(next);
        } else {
            setTimeout(() => this.check(), 3 * 1000);
            this.clearVideo();
        }
    }
}
