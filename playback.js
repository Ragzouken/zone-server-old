const EventEmitter = require("events");
const { performance } = require("perf_hooks");

const youtube = require('./youtube');

const copy = object => JSON.parse(JSON.stringify(object));

class Playback extends EventEmitter {
  constructor() {
    super();
    this.currentBeginTime = performance.now();
    this.currentEndTime = performance.now();
    this.currentVideo = undefined;
    this.queue = [];
  }

  async queueVideoById(videoId) {
    const details = await youtube.details(videoId);
    this.queue.push(details);
    this.emit('queue', details);
    this.check();
  }

  get idle() {
    return performance.now() >= this.currentEndTime;
  }

  get currentTime() {
    return performance.now() - this.currentBeginTime;
  }

  playVideo(video) {
    this.currentBeginTime = performance.now();
    this.currentEndTime = this.currentBeginTime + video.duration * 1000;
    this.currentVideo = video;
    const message = copy(video);
    message.time = 0;
    this.emit('play', message);
    setTimeout(() => this.check(), (video.duration + 1) * 1000);
  }

  clearVideo() {
    if (this.currentVideo) this.emit('stop', {});
    this.currentBeginTime = performance.now();
    this.currentEndTime = performance.now();
    this.currentVideo = undefined;
  }

  check() {
    if (this.idle) {
      const next = this.queue.shift();
      if (next) {
        this.playVideo(next);
      } else {
        setTimeout(() => this.check(), 3 * 1000);
        this.clearVideo();
      }
    }
  }

  skip() {
    const next = this.queue.shift();
    if (next) this.playVideo(next);
    else this.clearVideo();
  }
}

module.exports = Playback;
